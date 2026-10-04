/**
 * Engine — the operating loop.
 *
 * INPUT → UNDERSTAND → CLASSIFY → EXTRACT → DETECT TARGET → COMPLEXITY →
 * MISSING INFORMATION → STRATEGY → BUILD → RED-TEAM → VERIFY → SCORE →
 * OPTIMISE → OUTPUT
 *
 * The engine is deterministic and offline: it reasons about prompts, never
 * about the model's private chain-of-thought. Every decision is recorded so the
 * user can audit it.
 */

import { normalizeInput, estimateTokens, listOut, unique, titleCase } from '../util/text.mjs';
import { createTrace } from '../util/trace.mjs';
import { resolveTarget } from '../knowledge/targets.mjs';
import { detectIntent, goalSentence, classifyCategories, detectTarget, assessComplexity } from './classify.mjs';
import { extractSpec } from './extract.mjs';
import { detectModes } from './modes.mjs';
import { assessMissingInformation } from './clarify.mjs';
import { deriveFlags, deriveStrategyPayload, selectTechniques, COST_BUDGET } from './strategy.mjs';
import { buildPrompt, buildHandoff } from './build.mjs';
import { renderPrompt } from './render.mjs';
import { adversarialReview, quarantined } from './redteam.mjs';
import { qualityControl, scorePrompt } from './score.mjs';
import { analyzePrompt, compressPrompt, translatePrompt, testPrompt, comparePrompts, splitPromptPair } from './promptanalysis.mjs';
import { dedupeLines } from '../util/text.mjs';

/* ───────────────────────── edge cases ───────────────────────── */

function buildEdgeCases(ctx) {
  const out = [];
  const id = ctx.primary.id;
  if (ctx.flags.media) return out;

  if (ctx.flags.hasSourceText) out.push('The supplied material is thinner, messier or more contradictory than expected — work with what is there and name what is missing.');
  if (['coding', 'debugging', 'website', 'app-development', 'devops', 'automation'].includes(id)) {
    out.push('Input is empty, malformed, or outside the documented range — handle it explicitly rather than crashing or silently ignoring it.');
    out.push('The runtime differs from the stated environment (different version, missing dependency) — say what to check first.');
  }
  if (['research', 'web-research', 'academic'].includes(id)) out.push('Sources conflict, or only a single source supports a key claim — report that rather than presenting false consensus.');
  if (['writing', 'communication', 'marketing', 'social-media', 'creative-writing'].includes(id)) out.push('The brief stays silent on audience or length — apply the stated defaults and flag them in one line at most.');
  if (id === 'travel') out.push('Prices, timetables and visa rules change — mark anything time-sensitive as needing live confirmation.');
  if (['health', 'legal', 'finance'].includes(id)) out.push('The real situation involves facts that were not provided — state which facts would change the answer.');
  if (['decision', 'comparison', 'career'].includes(id)) out.push('A key option or constraint is missing from the list — say what would be added and how it might change the recommendation.');
  if (ctx.complexity.level >= 4) out.push('The task proves larger than the brief suggested — deliver the highest-value complete portion and state precisely what remains.');
  return out.slice(0, 6);
}

/* ───────────────────────── core generation ───────────────────────── */

function buildContext(raw, options = {}) {
  const trace = createTrace();
  const clean = normalizeInput(raw);
  const modes = detectModes(clean);

  /* 1 — understand */
  const t0 = trace.start();
  const intent = detectIntent(clean);
  const categories = classifyCategories(clean);
  const analysis = { intent, categories };

  // Extraction runs before this stage is recorded, because the stage summary is
  // what `strategy.rationale` reports back to the user. When an override attempt
  // was stripped, the raw headline is attacker-controlled text: echoing it would
  // state that the attack was understood as the objective, contradicting `goal`
  // (which correctly degrades). The guarded `spec.topic` is the same value the
  // goal sentence is built from, so the two can no longer disagree.
  const spec = extractSpec(clean, analysis);
  const understood = spec.injectedContent
    ? (spec.topic || '(no task remained once flagged content was removed)')
    : (intent.headline || '(short request)');

  trace.stage('understand', 'Understand', {
    summary: `Objective read as: ${understood}`,
    decisions: [
      { text: `Primary task: ${categories.primary.label}`, detail: categories.primary.hits?.length ? `matched on: ${categories.primary.hits.slice(0, 6).join(', ')}` : 'no strong signal — treated as unclassified' },
      ...(categories.secondary.length ? [{ text: `Also involves: ${categories.secondary.map((c) => c.label).join(', ')}` }] : []),
    ],
  });
  trace.closeStage(t0);

  /* 2 — complexity */
  const complexity = assessComplexity({ intent, categories, spec, flags: {}, raw: clean });

  /* 3 — target */
  const targetPick = options.targetId
    ? resolveTarget(options.targetId)
    : detectTarget(clean);
  const target = targetPick.target;

  /* 4 — flags & clarification */
  const clarity = assessMissingInformation({ raw: clean, primary: categories.primary, spec, complexity, flags: {} });
  const flags = deriveFlags({ analysis, spec, target, modes, clarity });
  flags.extraProcess = null;

  const ctx = {
    raw: clean,
    intent,
    analysis,
    categories,
    primary: categories.primary,
    spec,
    target,
    caps: target.caps,
    targetSource: targetPick.source || 'default',
    targetConfidence: targetPick.confidence ?? 0.4,
    targetAlternatives: targetPick.alternatives || [],
    unknownTarget: Boolean(targetPick.unknown),
    modes,
    complexity,
    flags,
    clarity,
    assumptions: clarity.assumed,
    trace,
  };

  ctx.objective = goalSentence(intent, categories.primary, spec);
  return ctx;
}

function prepareStrategy(ctx) {
  const payload = deriveStrategyPayload(ctx);
  Object.assign(ctx, payload);
  ctx.selected = selectTechniques(ctx);
  ctx.edgeCases = buildEdgeCases(ctx);
  ctx.edgeCasesAdded = ctx.edgeCases.length > 0;
  ctx.finalRules = [];
  ctx.trace.stage('strategy', 'Select strategy', {
    summary: `Level ${ctx.complexity.level} (${ctx.complexity.label}) — applied ${ctx.selected.length} techniques: ${ctx.selected.map((t) => t.label).join(', ') || 'none'}.`,
    decisions: [
      { text: `Technique budget: ${COST_BUDGET[ctx.complexity.level] ?? 4} cost units`, detail: 'chosen so the prompt stays proportionate to the task' },
      { text: `Template: ${ctx.primary.label}`, detail: 'section recipe selected from the task class' },
      { text: `Target: ${ctx.target.label}`, detail: ctx.unknownTarget ? 'requested target is not in the registry — fell back to a portable generic build' : `formatting follows ${ctx.target.style.promptFormat} conventions` },
    ],
  });
  return ctx;
}

/** Build, review, repair, rebuild, verify. */
function construct(ctx) {
  // Single source of truth for rendering: the section list. Any later change
  // (repairs, de-duplication) re-renders from it, so prompt and sections agree.
  ctx.renderPrompt = () => renderPromptFrom(ctx);
  let built = buildPrompt(ctx);
  ctx.sections = built.sections;
  ctx.template = built.template;
  ctx.prompt = built.prompt;
  ctx.title = built.title;
  ctx.tokens = estimateTokens(ctx.prompt);

  // Snapshot the first construction: lines that appear only after the red-team
  // pass were added as repairs and are attributed as such in provenance.
  const preRepair = new Set(ctx.sections.flatMap((s) => s.lines));

  const review = adversarialReview(ctx);
  ctx.review = review;

  // Repairs may have added rules to sections (output rules, quality gate): rebuild once.
  if (review.repairs.length) {
    built = buildPrompt(ctx);
    ctx.sections = built.sections;
    ctx.prompt = built.prompt;
  }
  ctx.tokens = estimateTokens(ctx.prompt);
  ctx.repairLines = new Set(ctx.sections.flatMap((s) => s.lines).filter((l) => !preRepair.has(l)));

  const tally = qualityControl(ctx);
  ctx.qualityChecks = tally;
  const failed = tally.filter((c) => !c.pass);
  ctx.trace.stage('verify', 'Red-team & verify', {
    summary: review.summary,
    decisions: [
      ...review.repairs.map((r) => ({ text: r })),
      ...failed.map((f) => ({ text: `${f.label} — ${f.note}`, detail: 'reported to the user rather than hidden' })),
    ],
  });
  return ctx;
}


/**
 * Line-level traceability. For every line in the final prompt, say where it came
 * from: a specific technique, a red-team repair, the request extractor, or the
 * archetype's section library. Nothing in the final prompt can lack a source —
 * which is the whole reason the output is reproducible and auditable.
 */
function buildProvenance(ctx) {
  if (ctx.flags?.media && ctx.media) return buildMediaProvenance(ctx);
  const techniqueLines = ctx.techniqueLines || new Map();
  return (ctx.sections || []).map((s) => ({
    section: s.title,
    lines: s.lines.length,
    sectionSources: s.from || [],
    trace: s.lines.map((line) => {
      if (ctx.repairLines && ctx.repairLines.has(line)) {
        const repair = (ctx.review?.repairs || []).find((r) => matchesRepair(r, line));
        return { text: line, source: 'adversarial review (repair)', detail: repair || 'failure-mode safeguard added before delivery' };
      }
      const t = techniqueLines.get(line);
      if (t) return { text: line, source: `technique: ${t.label}`, detail: t.description };
      const from = (s.from || [])[0] || 'section library';
      return { text: line, source: from, detail: detailFor(from) };
    }),
  }));
}


/**
 * Media prompts are a single descriptive block rather than sections, so their
 * provenance is reported per clause: which parts came from the user's own
 * description and which were supplied as defaults because nothing was stated.
 */
function buildMediaProvenance(ctx) {
  const m = ctx.media;
  const assumed = new Set((m.assumed || []).map((a) => a.split('→')[0].trim().toLowerCase()));
  const cue = (label, key, value) => {
    const defaulted = assumed.has(key) || !value;
    return {
      text: `${label}: ${value || '(engine default)'}`,
      source: defaulted ? 'engine default (you did not specify)' : 'media cue bank (matched your description)',
      detail: defaulted
        ? `Nothing about ${key} was stated, so the engine supplied the most common choice. Change it if it is wrong.`
        : `Recognised from your own wording ("${key}").`,
    };
  };
  return [{
    section: 'PROMPT (media)',
    lines: 3 + (m.parameters?.length || 0) + (m.negatives?.length ? 1 : 0),
    sectionSources: ['media-prompt builder'],
    trace: [
      { text: m.prompt, source: 'your words, arranged by the composition stack', detail: 'Subject and action come from you; the stack orders them the way image/video models weight them.' },
      cue('Lighting', 'lighting', (m.prompt.match(/lit by ([^,]+)/) || [])[1]),
      cue('Style', 'medium', (m.prompt.match(/(?:^|, )([a-z ]+) style/) || [])[1]),
      ...(m.parameters || []).map((p) => ({ text: p, source: 'parameter rule (model target)', detail: 'Chosen from the target model\'s accepted parameters, not invented.' })),
      ...(m.negatives?.length ? [{ text: `Negative constraints: ${m.negatives.join(', ')}`, source: 'quality defaults + your exclusions', detail: 'A standard artefact-prevention list, plus anything you asked to exclude.' }] : []),
    ],
  }];
}

function matchesRepair(repair, line) {
  const key = repair.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 5);
  const l = line.toLowerCase();
  return key.some((w) => l.includes(w));
}

function detailFor(from) {
  if (/extractor/.test(from)) return 'your own words turned into structure — nothing invented';
  if (/taxonomy/.test(from)) return 'the default expertise for this task class';
  if (/recipe/.test(from)) return 'the section library for this archetype';
  if (/output-format/.test(from)) return 'chosen so the shape of the answer is fixed, not left to chance';
  if (/edge-case/.test(from)) return 'generated from known failure patterns of this task class';
  if (/conflict/.test(from)) return 'your brief contained tension; this resolves it by priority';
  if (/media-prompt/.test(from)) return 'the composition stack image/video models actually condition on';
  if (/rubric/.test(from)) return 'shared evaluation criteria, so "good" is defined rather than assumed';
  if (/capability/.test(from)) return 'checked against the target model profile before writing';
  return 'engine default';
}


/**
 * Render the current section list — the only way linguistic prompt text is
 * produced. Media prompts are rendered by their own builder (they are a single
 * descriptive block, not sections) and are left untouched here.
 */
function renderPromptFrom(ctx) {
  if (ctx.flags?.media) return ctx.prompt;
  return renderPrompt(ctx.sections, { target: ctx.target, title: ctx.title });
}

/* ───────────────────────── optimisation ───────────────────────── */

/**
 * Optimisation pass: collapse near-duplicate lines, then re-render so the
 * prompt text and the section list can never drift apart.
 */
function tidyPrompt(ctx) {
  for (const s of ctx.sections) {
    s.lines = dedupeLines(s.lines.join('\n')).split('\n').filter(Boolean);
  }
  ctx.prompt = ctx.renderPrompt ? ctx.renderPrompt() : ctx.prompt;
  return ctx;
}

function buildVariants(ctx) {
  const variants = {};

  const lean = compressPrompt(ctx.prompt, { ratio: 0.5 });
  variants.fast = { label: 'V1 — Lean', prompt: lean.text, tokens: lean.after.tokens, note: 'Same objective and constraints, filler removed. Use when the target has a small context or you want a shorter prompt.' };

  variants.balanced = { label: 'V2 — Balanced', prompt: ctx.prompt, tokens: ctx.tokens, note: 'The recommended build.' };

  if (ctx.complexity.level >= 3 || ctx.flags.needsVerification) {
    const extra = [
      ctx.prompt,
      '',
      '---',
      '',
      '## ADDITIONAL VERIFICATION PASS (optional, high-stakes output)',
      '- Re-derive the central claim or calculation by an independent route and compare.',
      '- For every number or named entity in the answer, confirm its source inside the supplied material or mark it as unverified.',
      '- Re-read the requirements line by line and confirm each one is visibly satisfied; list any that are not.',
      '- Attack your own answer once: what is the strongest argument that it is wrong? Address it or acknowledge it.',
    ].join('\n');
    variants.maximum = { label: 'V3 — Maximum quality', prompt: extra, tokens: estimateTokens(extra), note: 'Adds an explicit verification pass. Slower, but safer for work that will be acted on.' };
  }

  return variants;
}

/** Split a complex task into a sequence of prompts with hand-off contracts. */
function buildWorkflow(ctx) {
  const stages = ctx.planStages;
  if (stages.length < 3) return null;
  const shared = [
    `Objective: ${ctx.spec.objective}`,
    ctx.spec.audience ? `Audience: ${ctx.spec.audience}.` : null,
    ctx.flags.academicLevel ? `Standard: ${ctx.flags.academicLevel}.` : null,
    ctx.spec.constraints.length ? `Constraints:\n${ctx.spec.constraints.map((c) => `- ${c}`).join('\n')}` : null,
    ctx.spec.forbidden.length ? `Never include: ${listOut(ctx.spec.forbidden)}.` : null,
  ].filter(Boolean).join('\n');

  const prompts = stages.map((stage, i) => {
    const isLast = i === stages.length - 1;
    return {
      step: i + 1,
      title: stage,
      prompt: [
        `## CONTEXT (carry forward — do not re-derive)`,
        shared,
        '',
        `## THIS STEP`,
        `${i + 1}. ${stage}`,
        '',
        `## RULES`,
        i === 0
          ? '- Work only on this step. Do not jump ahead to later steps.'
          : '- Use the previous step’s output as your input; do not start over.',
        isLast
          ? '- This is the final step: deliver the complete, finished result.'
          : '- End with a HAND-OFF block: decisions made, constraints discovered, open questions. The next step receives only that block plus its own instruction.',
        '- If something required is missing, state the assumption inline and continue.',
      ].join('\n'),
      takes: i === 0 ? 'the original brief' : `step ${i} output`,
      produces: stage,
    };
  });

  return {
    why: 'One prompt would have to hold six incompatible jobs at once: gathering, judging, synthesising, writing and verifying. Splitting them keeps each step focused, makes errors visible at the step where they occur, and lets you re-run a single stage instead of the whole task.',
    prompts,
    handoff: 'Paste the HAND-OFF block from the previous step at the top of the next prompt.',
  };
}

/* ───────────────────────── public API ───────────────────────── */

/**
 * Generate an optimised prompt for a naturally-described situation.
 * @param {string} input free-form request
 * @param {{targetId?:string, advanced?:boolean, answers?:object, variants?:boolean}} [options]
 */
export function generate(input, options = {}) {
  if (!input || !String(input).trim()) {
    return errorResult('No input provided. Describe the situation in your own words — even a single sentence is enough.');
  }

  const ctx = buildContext(input, options);

  /* ── routed modes: the user handed us an existing prompt ── */
  const hasPastedPrompt = ctx.modes.has('improve') || ctx.modes.has('compress') || ctx.modes.has('expand') || ctx.modes.has('test') || ctx.modes.has('translate');
  if (hasPastedPrompt) return improveExistingPrompt(ctx, options);
  if (ctx.modes.has('compare')) return compareExistingPrompts(ctx);

  /* ── standard construction ── */
  applyAnswers(ctx, options.answers);
  prepareStrategy(ctx);
  construct(ctx);
  tidyPrompt(ctx);
  ctx.tokens = estimateTokens(ctx.prompt);
  const score = scorePrompt(ctx);
  ctx.score = score;
  ctx.handoff = buildHandoff(ctx);

  ctx.trace.stage('score', 'Score', {
    summary: `Hardness score ${score.total}/100 (${score.band}); ${score.passedChecks} quality checks passed.`,
    decisions: score.levers.map((l) => ({ text: l })),
  });

  const result = composeResult(ctx, options);
  ctx.trace.stage('output', 'Output', {
    summary: `Final prompt: ~${ctx.tokens} tokens, ${ctx.sections.length} sections, template "${ctx.template}".`,
  });
  return result;
}

function composeResult(ctx, options) {
  const promptOnly = ctx.modes.promptOnly || options.minimal;
  const wantVariants = options.variants !== false && !promptOnly && !ctx.flags.media;
  const variants = wantVariants ? buildVariants(ctx) : ctx.flags.media ? { balanced: { label: 'V2 — Balanced', prompt: ctx.prompt, tokens: ctx.tokens, note: 'Media prompts are already minimal.' } } : {};
  const workflow = (options.workflow || ctx.modes.has('workflow') || ctx.complexity.level >= 4) && !ctx.flags.media ? buildWorkflow(ctx) : null;

  const warnings = [];
  if (ctx.unknownTarget) warnings.push(`The target you named is not in the registry, so a portable build was produced. It is written to work on any capable model — tell me the exact model and I will tune it.`);
  if (!ctx.target.verified && !ctx.target.generic) warnings.push(`Capabilities for ${ctx.target.label} are a design assumption, not a verified snapshot — model features change. The prompt states its assumptions so you can correct them.`);
  if (ctx.targetSource === 'unspecified' && ctx.targetAlternatives.length) {
    warnings.push(`No target model was specified. Built for a generic model; the closest detected matches were ${ctx.targetAlternatives.map((t) => t.label).join(', ')} — pick one for tighter tuning.`);
  }
  if (ctx.spec.injectedContent) warnings.push('The text you supplied contained instructions aimed at a model rather than at the task (an attempt to override rules or reveal a prompt). Those lines were removed and flagged — they were never treated as orders.');
  if (ctx.spec.conflicts.length) warnings.push(`Your brief contains tension (${ctx.spec.conflicts.join('; ')}). The prompt resolves it by priority and tells the model to state which resolution it took.`);
  if (ctx.tokens > (ctx.target.style?.contextBudget || 24000) * 0.5) warnings.push('This prompt is long relative to the target’s context. The Lean variant keeps the same constraints in fewer tokens.');

  const reasoning = [
    ctx.trace.steps.find((s) => s.id === 'understand')?.summary,
    `Complexity level ${ctx.complexity.level}/5 — ${ctx.complexity.reasons.slice(0, 2).join(' ')}`,
    `Optimised for ${ctx.target.label} using ${ctx.selected.length} techniques.`,
  ].filter(Boolean);

  return {
    version: '1.0',
    engine: 'promptforge',
    mode: ctx.modes.primary,
    modes: ctx.modes.list.map((m) => m.id),

    goal: ctx.objective,
    understoodGoal: ctx.objective,

    strategy: {
      summary: strategySummary(ctx),
      rationale: reasoning,
      complexity: { level: ctx.complexity.level, label: ctx.complexity.label, reasons: ctx.complexity.reasons },
      categories: [
        { id: ctx.primary.id, label: ctx.primary.label, confidence: ctx.categories.confidence, evidence: ctx.categories.primary.hits || [] },
        ...ctx.categories.secondary.map((c) => ({ id: c.id, label: c.label, evidence: c.hits || [] })),
      ],
      techniques: ctx.selected.map((t) => ({ id: t.id, label: t.label, family: t.family, cost: t.cost, risk: t.risk, description: t.description })),
      template: ctx.template,
      target: { id: ctx.target.id, label: ctx.target.label, source: ctx.targetSource, confidence: ctx.targetConfidence, assumptions: ctx.target.notes || [] },
      planStages: ctx.planStages,
      sections: ctx.sections.map((s) => s.title),
    },

    prompt: ctx.prompt,
    title: ctx.title,
    target: {
      id: ctx.target.id, label: ctx.target.label, verified: ctx.target.verified,
      style: { promptFormat: ctx.target.style.promptFormat, contextBudget: ctx.target.style.contextBudget, guidance: ctx.target.style.guidance },
    },

    customization: buildCustomization(ctx),

    score: {
      total: ctx.score.total,
      band: ctx.score.band,
      verdict: ctx.score.verdict,
      calibration: ctx.score.calibration,
      dimensions: ctx.score.dimensions,
      weaknesses: ctx.score.weaknesses,
      levers: ctx.score.levers,
    },

    qualityChecks: ctx.qualityChecks.map((c) => ({ label: c.label, pass: c.pass, note: c.note })),
    failureModes: ctx.review.failureModes,
    repairs: ctx.review.repairs,
    injectionDefense: ctx.review.injections,

    assumptions: ctx.assumptions.map((a) => ({ field: a.field, assumption: a.assumption })),
    openQuestions: ctx.clarity.questions,
    clarificationReason: ctx.clarity.reason,
    unknowns: ctx.spec.unknowns,

    variants: Object.values(variants),
    workflow,
    handoff: ctx.handoff,
    provenance: buildProvenance(ctx),
    warnings,

    limitations: [
      'This engine reasons about prompt structure and instructions. It does not run your prompt against a model, so scores describe specification quality, not measured model output.',
      ctx.target.verified ? 'Capability flags for the generic profile are conservative by design.' : 'Target capability profiles are design assumptions — verify anything critical against current vendor documentation.',
    ],

    trace: ctx.trace.steps.map((s) => ({ id: s.id, label: s.label, summary: s.summary, decisions: s.decisions })),
    researchContent: null,
  };
}

function strategySummary(ctx) {
  const parts = [];
  parts.push(`Recognised as ${ctx.categories.primary.label.toLowerCase()} at complexity level ${ctx.complexity.level} of 5`);
  if (ctx.categories.secondary.length) parts.push(`with ${ctx.categories.secondary.map((c) => c.label.toLowerCase()).join(' and ')} elements`);
  if (ctx.selected.length) parts.push(`Applying ${listOut(ctx.selected.slice(0, 4).map((t) => t.label.toLowerCase()))}${ctx.selected.length > 4 ? ` and ${ctx.selected.length - 4} more` : ''}`);
  if (ctx.flags.media) parts.push('Shaped as a media generation prompt rather than a linguistic brief');
  else parts.push(`Structured as a ${ctx.template} brief in ${ctx.sections.length} sections for ${ctx.target.label}`);
  return parts.join('. ') + '.';
}

function buildCustomization(ctx) {
  const rows = [];
  if (ctx.spec.audience) rows.push({ field: 'Audience', value: ctx.spec.audience, hint: 'Change this and the vocabulary and depth assumptions change with it.' });
  else rows.push({ field: 'Audience', value: 'informed non-specialist', hint: 'Name a specific audience for sharper output.' });
  if (ctx.spec.lengthTarget) rows.push({ field: 'Length', value: ctx.spec.lengthTarget, hint: 'The model respects this literally.' });
  if (ctx.spec.tone) rows.push({ field: 'Tone', value: ctx.spec.tone, hint: 'Swap for a different register if needed.' });
  if (ctx.flags.techStack.length) rows.push({ field: 'Stack', value: ctx.flags.techStack.join(', '), hint: 'Stated to prevent the model introducing unrequested frameworks.' });
  if (ctx.flags.academicLevel) rows.push({ field: 'Academic standard', value: ctx.flags.academicLevel, hint: 'Raise or lower to change the expected depth.' });
  if (ctx.flags.citationStyle) rows.push({ field: 'Citation style', value: ctx.flags.citationStyle, hint: 'Must match the marker’s requirement.' });
  if (ctx.spec.country) rows.push({ field: 'Region', value: titleCase(ctx.spec.country), hint: 'Drives which sources, rules and prices apply.' });
  if (ctx.spec.deadline) rows.push({ field: 'Deadline', value: ctx.spec.deadline, hint: 'Keeps the plan sequenced to the real date.' });
  for (const a of ctx.assumptions.slice(0, 5)) rows.push({ field: `Assumed: ${a.field}`, value: a.assumption, hint: 'Correct this inside the prompt if it is wrong.' });
  if (ctx.target.id !== 'generic') rows.push({ field: 'Target model', value: ctx.target.label, hint: 'Switch targets to re-tune structure and formatting.' });
  return rows;
}

function applyAnswers(ctx, answers) {
  if (!answers || typeof answers !== 'object') return;
  for (const [k, v] of Object.entries(answers)) {
    if (!v) continue;
    const val = String(v);
    if (k === 'audience') ctx.spec.audience = val;
    else if (k === 'length') ctx.spec.lengthTarget = val;
    else if (k === 'tone') ctx.spec.tone = val;
    else if (k === 'citation' || k === 'citationStyle') ctx.spec.citationStyle = val;
    else if (k === 'level' || k === 'academicLevel') ctx.spec.academicLevel = val;
    else if (k === 'language') ctx.spec.techStack = unique([...ctx.spec.techStack, val]);
    else if (k === 'budget') ctx.spec.budget = val;
    else if (k === 'dest') ctx.spec.context.push(`Destination: ${val}`);
    else if (k === 'style') ctx.spec.context.push(`Visual style: ${val}`);
    else if (k === 'aspect') ctx.spec.context.push(`Aspect ratio: ${val}`);
    else ctx.spec.context.push(`${k}: ${val}`);
  }
  ctx.assumptions = ctx.assumptions.filter((a) => !answers[a.field]);
}

/* ───────────────────────── routed handlers ───────────────────────── */

function improveExistingPrompt(ctx, options) {
  const diag = analyzePrompt(ctx.raw);
  const isCompress = ctx.modes.has('compress');
  const isTest = ctx.modes.has('test');

  if (isCompress) {
    const c = compressPrompt(ctx.raw);
    return {
      version: '1.0', engine: 'promptforge', mode: 'compress', modes: ctx.modes.list.map((m) => m.id),
      goal: 'Compress the prompt without losing the load-bearing instructions.',
      original: { prompt: diag.text, stats: diag.stats, score: diag.dimensionScores.overall },
      compressed: { prompt: c.text, tokens: c.after.tokens, words: c.after.words, saved: c.saved, keptRules: c.keptRules },
      removed: c.removed,
      preserved: ['Objective', 'Constraints and prohibitions', 'Output contract', 'Verification and uncertainty rules', 'Numbers, formats and negative constraints'],
      warnings: c.saved < 15 ? ['This prompt was already reasonably tight — most of its length carries constraints. Further compression risks losing requirements.'] : [],
      strategy: { summary: `Compressed from ${c.before.words} to ${c.after.words} words (${c.saved}% smaller) while keeping every constraint.` },
      limitations: ['Compression is structural. Review the preserved list before using it for high-stakes work.'],
    };
  }

  if (isTest) {
    const t = testPrompt(ctx.raw);
    return {
      version: '1.0', engine: 'promptforge', mode: 'test', modes: ctx.modes.list.map((m) => m.id),
      goal: 'Simulate how this prompt fails before you rely on it.',
      original: { prompt: diag.text, stats: diag.stats },
      resiliency: t.resiliency,
      scenarios: t.scenarios.map((s) => ({ label: s.label, input: s.input, status: s.status, likelihood: Math.round(s.likelihood * 100), missing: s.missing, failure: s.failure, patch: s.patch })),
      risks: t.risks,
      diagnostics: t.diagnostics.dimensionScores,
      patchedPrompt: patchPrompt(ctx.raw, t),
      strategy: { summary: `Resiliency ${t.resiliency}/100 — ${t.risks.length} scenario${t.risks.length === 1 ? '' : 's'} likely to fail with the current prompt.` },
      warnings: ['Scenario likelihoods are structural predictions from the safeguards present, not measurements.'],
      limitations: ['No model was invoked; this is a static analysis of the prompt text.'],
    };
  }

  /* improve / expand / translate — rebuild a stronger prompt, then report the delta */
  if (ctx.modes.has('translate') && options.targetId) {
    const source = extractPastedPrompt(ctx.raw);
    const tr = translatePrompt(source, ctx.target);
    const translated = analyzePrompt(tr.text);
    return {
      version: '1.0', engine: 'promptforge', mode: 'translate', modes: ctx.modes.list.map((m) => m.id),
      goal: `Rewrite this prompt for ${ctx.target.label} without changing its intent.`,
      original: { prompt: source, stats: analyzePrompt(source).stats },
      prompt: tr.text,
      title: `${titleCase(ctx.target.label)} version`,
      target: { id: ctx.target.id, label: ctx.target.label },
      note: tr.note,
      score: {
        total: translated.dimensionScores.overall,
        band: translated.dimensionScores.overall >= 72 ? 'solid' : 'usable',
        verdict: `Restructured for ${ctx.target.label}. Intent preserved; structure now follows the target's parsing conventions.`,
        dimensions: [], levers: [],
        calibration: 'Specification quality after translation.',
      },
      customization: [],
      qualityChecks: [],
      strategy: { summary: tr.note },
      // Both warnings matter: the translate gap used to be silently dropped
      // because two `warnings` keys in one object literal is legal and the
      // second one wins.
      warnings: [
        ...(translated.missing.length
          ? [`This prompt still lacks: ${translated.missing.slice(0, 4).join(', ').replace(/_/g, ' ')}. Run Improve mode to close those gaps.`]
          : []),
        ...(ctx.target.verified
          ? []
          : [`Formatting follows ${ctx.target.label}'s documented conventions; capability levels may change between model versions.`]),
      ],
      limitations: ['Intent is preserved; wording may be reordered to suit the target’s parsing conventions.'],
    };
  }

  const rebuilt = generateFromAnalysis(ctx, options);
  const improvements = diag.weaknesses.map((w) => ({
    issue: w.label,
    severity: w.severity,
    why: w.explanation,
    fix: w.fix,
    applied: appliedFix(w.id, rebuilt),
  }));

  return {
    ...rebuilt,
    mode: ctx.modes.has('expand') ? 'expand' : 'improve',
    original: {
      prompt: diag.text,
      stats: diag.stats,
      score: diag.dimensionScores.overall,
      dimensions: diag.dimensionScores,
      strengths: diag.strengths,
      weaknesses: diag.weaknesses,
    },
    improvements,
    comparison: comparePrompts(diag.text, rebuilt.prompt, { labelA: 'Original', labelB: 'Rebuilt' }),
    strategy: { ...rebuilt.strategy, summary: `Rebuilt from the original: ${diag.weaknesses.length} weaknesses addressed (${diag.weaknesses.slice(0, 3).map((w) => w.label.replace('Missing: ', '')).join(', ')}).` },
  };
}

/**
 * Isolate the actual prompt from an "improve this prompt: <prompt>" message and
 * drop the parts that describe the *request about* the prompt rather than the
 * prompt's own instructions.
 */
function extractPastedPrompt(raw) {
  let s = String(raw);
  s = s.replace(/^[\s\S]{0,120}?\b(?:improve|rewrite|fix|refine|upgrade|optimi[sz]e|expand|strengthen|rate|review|critique|test|shorten|compress|translate|convert|port|adapt)\b[^.\n:]{0,30}\bprompt\b\s*[:\-–]\s*/i, '');
  s = s.replace(/^(?:here(?:'s| is)\s+(?:my|the)\s+prompt\s*[:\-]?\s*)/i, '');
  // The old role line is captured as a weakness elsewhere; it must not become the objective.
  s = s.replace(/^\s*(?:you are|act as|as an?)\b[^.\n]*[.\n]\s*/i, '');
  s = s.replace(/\b(?:please\s+)?(?:make it|make this) (?:good|better|nice|great|awesome)\b[.!\s]*/gi, '');
  s = s.replace(/\bwrite me\b/gi, 'write');
  return s.replace(/\s{2,}/g, ' ').trim() || String(raw);
}

function generateFromAnalysis(parentCtx, options) {
  // The pasted prompt is untrusted input: re-derive the spec from it, then build fresh.
  const child = buildContext(quarantined(extractPastedPrompt(parentCtx.raw)).content, options);
  applyAnswers(child, options.answers);
  prepareStrategy(child);
  construct(child);
  tidyPrompt(child);
  child.tokens = estimateTokens(child.prompt);
  child.score = scorePrompt(child);
  child.handoff = buildHandoff(child);
  return composeResult(child, { ...options, variants: options.variants !== false });
}

function appliedFix(weaknessId, rebuilt) {
  const sections = rebuilt.strategy?.sections || [];
  const map = {
    objective: 'OBJECTIVE now states the goal in one unambiguous sentence.',
    context: 'CONTEXT carries the audience, situation and inputs.',
    constraints: 'CONSTRAINTS list explicit rules and prohibitions.',
    outputFormat: 'OUTPUT FORMAT pins structure, length and formatting.',
    length: 'A concrete length target is stated.',
    verification: 'VERIFICATION requires the model to check its own output.',
    uncertainty: 'Assumptions and unknowns must be labelled instead of guessed.',
    edgeCases: 'EDGE CASES describe the situations the answer must survive.',
    delimiters: 'Input material is now delimited so data cannot be read as instruction.',
    injection: 'Prompt-injection defence is stated.',
    scope: 'Scope boundaries are explicit.',
    role: 'SYSTEM ROLE sets the expertise the task needs.',
    quality: 'QUALITY CRITERIA define what “good” means here.',
    examples: 'Example/style anchoring was added where the brief allowed it.',
    process: 'PROCESS decomposes the work into ordered stages.',
    audience: 'The audience is named.',
    tone: 'Tone is specified.',
    stop: 'A no-preamble rule keeps the output clean.',
    language: 'Output language is stated.',
    difficulty: 'Reader level is calibrated.',
    redundancy: 'Duplicate lines were collapsed.',
    vagueness: 'Vague qualifiers were replaced with testable criteria.',
    longSentences: 'Long sentences were split into one instruction per line.',
  };
  return map[weaknessId] || (sections.length ? 'Addressed in the rebuilt structure.' : 'Addressed.');
}

function patchPrompt(raw, testResult) {
  const additions = testResult.risks.map((r) => `- ${r.patch.replace(/^Add: /, '')}`);
  if (!additions.length) return raw;
  return `${raw.trim()}\n\n## ROBUSTNESS RULES\n${unique(additions).map((a) => a.replace(/^-\s*/, '- ')).join('\n')}`;
}

function compareExistingPrompts(ctx) {
  const [a, b] = splitPromptPair(ctx.raw);
  const cmp = comparePrompts(a, b, { labelA: 'Prompt A', labelB: 'Prompt B' });
  return {
    version: '1.0', engine: 'promptforge', mode: 'compare', modes: ctx.modes.list.map((m) => m.id),
    goal: 'Determine which prompt is stronger, and why.',
    prompts: { A: a.trim(), B: b.trim() },
    rows: cmp.rows.map((r) => ({ dimension: humaniseDim(r.dimension), a: r.a, b: r.b, better: r.better, gap: Math.abs(r.a - r.b) })),
    scores: cmp.scores,
    winner: cmp.winner,
    verdict: cmp.verdict,
    reasons: cmp.reasons.length ? cmp.reasons : ['The prompts are close on every dimension — the difference is mostly stylistic.'],
    uniqueToA: cmp.uniqueToA,
    uniqueToB: cmp.uniqueToB,
    recommendation: buildMergeAdvice(cmp),
    strategy: { summary: cmp.verdict },
    warnings: ['Scores measure specification quality of each prompt, not measured output quality.'],
    limitations: ['Static analysis: no model was invoked. Two prompts that score equally can still behave differently on a real input.'],
  };
}

function buildMergeAdvice(cmp) {
  if (cmp.winner === 'Prompt A' || cmp.winner === 'Prompt B') {
    const loserChecks = cmp.winner === 'Prompt A' ? cmp.uniqueToB : cmp.uniqueToA;
    if (loserChecks.length) {
      return `Use ${cmp.winner}, and port over the safeguard the other prompt has that it lacks: ${loserChecks.join(', ').replace(/_/g, ' ')}.`;
    }
    return `Use ${cmp.winner} as-is.`;
  }
  return 'Merge them: keep the stronger output contract from one and the stronger context from the other.';
}

function humaniseDim(d) {
  return d.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

/* ───────────────────────── explain mode ───────────────────────── */

export function explain(result, originalPrompt = null) {
  const sections = result.strategy?.sections || [];
  const parts = [];
  parts.push({
    heading: 'Why it is structured this way',
    body: [
      `The task was classified as ${result.strategy.categories[0].label.toLowerCase()} at complexity level ${result.strategy.complexity.level}/5.`,
      `A ${result.strategy.template} template was used, producing ${sections.length} sections: ${sections.join(' → ')}.`,
      `Sections are ordered so the model reads role, context and objective before it reads rules, which is when those rules are most likely to be honoured.`,
    ],
  });
  parts.push({
    heading: 'Techniques used, and why',
    body: result.strategy.techniques.map((t) => `${t.label} — ${t.description}${t.risk ? ` Watch for: ${t.risk.toLowerCase()}` : ''}`),
  });
  parts.push({
    heading: 'Load-bearing parts (do not remove)',
    body: [
      'MUST requirements and negative constraints — these define the output.',
      'The output contract — without it the shape of the answer is random.',
      'Verification and uncertainty rules — these prevent confident invention.',
      'Assumptions — they make a wrong guess visible instead of silent.',
    ],
  });
  parts.push({
    heading: 'Safe to change',
    body: (result.customization || []).map((c) => `${c.field}: currently "${c.value}" — ${c.hint}`),
  });
  if (originalPrompt) {
    const cmp = comparePrompts(originalPrompt, result.prompt, { labelA: 'Original', labelB: 'Rebuilt' });
    parts.push({
      heading: 'Why this beats the original',
      body: [
        cmp.verdict,
        ...cmp.reasons,
        'The original was scored on the same dimensions, so this is a like-for-like comparison of specification quality.',
      ],
    });
  }
  parts.push({
    heading: 'How to tell if it is working',
    body: [
      'Run it once with a real input. If the output is the right shape but shallow, add specifics to the CONTEXT section.',
      'If the output ignores a rule, that rule is competing with another — move it to the top or make it more concrete.',
      'If the output is correct but generic, the specificity is in the prompt but not in the input: give it real detail to work from.',
    ],
  });
  return parts;
}

/* ───────────────────────── helpers ───────────────────────── */

export function errorResult(message) {
  return {
    version: '1.0', engine: 'promptforge', error: message,
    goal: '', prompt: '', score: { total: 0, band: 'n/a', verdict: message, dimensions: [], levers: [] },
    strategy: { summary: message, techniques: [], categories: [], complexity: { level: 0, label: 'n/a' }, sections: [] },
    warnings: [message], limitations: [],
  };
}

export { buildWorkflow, buildVariants, buildCustomization };
