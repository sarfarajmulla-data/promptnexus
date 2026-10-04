/**
 * Template library.
 *
 * Design: a *section library* (one builder per architectural block) plus a
 * per-archetype *recipe* (ordered section ids). Templates are never copied
 * blindly — each builder reads the extracted spec, the chosen techniques and
 * the target profile, and emits only sections that carry information for this
 * specific request. Sections that would be empty are omitted entirely.
 */

import { listOut, unique } from '../util/text.mjs';

/* ─────────────────────────── helpers ─────────────────────────── */

const sec = (title, lines) => {
  const clean = lines.flat().filter(Boolean).map((l) => String(l).trim()).filter(Boolean);
  return clean.length ? { title, lines: clean } : null;
};

const asBul = (items = [], marker = '-') => (Array.isArray(items) ? items : []).filter(Boolean).map((i) => `${marker} ${i}`);
const asNum = (items = []) => (Array.isArray(items) ? items : []).filter(Boolean).map((i, n) => `${n + 1}. ${i}`);

/* ─────────────────────── section builders ─────────────────────── */

export const SECTIONS = {
  role: (c) => sec('SYSTEM ROLE', [
    c.spec.role[0],
    ...(c.spec.role || []).slice(1),
    c.flags.isBeginner
      ? 'Assume the user is intelligent but new to this field: define jargon the first time it appears and prefer concrete examples over abstractions.'
      : c.flags.isExpert
        ? 'Assume deep domain fluency. Use precise terminology without explaining standard concepts.'
        : null,
    c.flags.isAcademic ? 'Work to university standard: defensible claims, explicit reasoning, clean structure.' : null,
  ]),

  mission: (c) => sec('MISSION', [
    c.spec.deliverable
      ? `Deliver: ${c.spec.deliverable}.`
      : `Deliver the outcome described under OBJECTIVE.`,
    c.spec.outcome ? `Success means: ${c.spec.outcome}` : null,
  ]),

  context: (c) => sec('CONTEXT', [
    ...asBul(c.spec.context),
    c.spec.audience ? `Audience for the final output: ${c.spec.audience}.` : null,
    c.spec.selfContext ? `About the user: ${c.spec.selfContext}` : null,
    c.flags.constraintFacts?.length ? `Operating constraints already stated: ${listOut(c.flags.constraintFacts)}.` : null,
  ]),

  objective: (c) => sec('OBJECTIVE', [
    c.spec.objective,
    c.spec.secondaryObjectives?.length ? `Also address: ${listOut(c.spec.secondaryObjectives)}.` : null,
    c.flags.asksImpossible ? 'If part of this request cannot be done by an AI, say so plainly and deliver the largest useful part.' : null,
  ]),

  inputs: (c) => sec('INPUT MATERIAL', [
    c.spec.inputs.length
      ? `You will receive: ${listOut(c.spec.inputs)}.`
      : 'No input material is supplied — work from this brief alone.',
    c.flags.hasSourceText ? `Input arrives inside ${c.delimiterStyle}.` : null,
    asBul(c.spec.inputRules).join('\n'),
  ]),

  requirements: (c) => {
    const r = c.spec.requirements;
    const out = [];
    if (r.must.length) out.push('MUST — non-negotiable:', ...asBul(r.must.map((m) => `**${m}**`)));
    if (r.should.length) out.push('SHOULD — do these unless they conflict with a MUST:', ...asBul(r.should));
    if (r.optional.length) out.push('OPTIONAL — include only if it genuinely adds value:', ...asBul(r.optional));
    return out.length ? sec('REQUIREMENTS', out.flat()) : null;
  },

  constraints: (c) => sec('CONSTRAINTS', [
    c.spec.constraints.length ? asNum(c.spec.constraints) : null,
    c.spec.forbidden?.length ? `Never include: ${listOut(c.spec.forbidden)}.` : null,
    c.flags.tone ? `Tone: ${c.flags.tone}.` : null,
    c.flags.lengthTarget ? `Length: ${c.flags.lengthTarget}.` : null,
    c.spec.mustNotDo?.length ? `Do not: ${listOut(c.spec.mustNotDo)}.` : null,
  ].flat()),

  priorities: (c) => sec('PRIORITIES WHEN REQUIREMENTS CONFLICT', [
    'Resolve conflicts in this order: safety → factual accuracy → the user’s explicit requirements → the objective → verifiability → technical correctness → usefulness → clarity → brevity → style preference.',
    c.spec.conflicts.length
      ? `Detected tension in the brief: ${listOut(c.spec.conflicts.map((x) => `"${x}"`))}. Resolve it using the order above and state your resolution in one line rather than silently choosing.`
      : null,
  ]),

  process: (c) => {
    const steps = (c.selected || []).filter((t) => t.family === 'process' || t.family === 'reasoning').flatMap((t) => t.rendered || []);
    return steps.length ? sec('PROCESS', [...asNum(steps), c.flags.extraProcess || null].flat().filter(Boolean)) : null;
  },

  quality: (c) => sec('QUALITY CRITERIA', [
    'Good work here means:',
    ...asBul(c.rubricItems.map((r) => `**${r.name}** — ${r.test}`)),
    c.flags.qualityGate || null,
  ]),

  verification: (c) => {
    const lines = (c.selected || []).filter((t) => t.family === 'evaluation' && t.id !== 'rubric').flatMap((t) => t.rendered || []);
    const extra = c.flags.extraVerification || [];
    const all = [...lines, ...extra];
    return all.length ? sec('VERIFICATION', asBul(all, '').length ? all : all) : null;
  },

  output: (c) => sec('OUTPUT FORMAT', [
    c.spec.formatSpec,
    ...asBul(c.flags.outputRules || []),
    c.flags.wantsMachine ? 'Output must be machine-parseable exactly as specified — no surrounding commentary.' : null,
  ]),

  edgeCases: (c) => sec('EDGE CASES', [
    ...asBul(c.edgeCases),
  ]),

  failure: (c) => sec('WHEN INFORMATION IS MISSING', [
    c.spec.unknowns.length ? `Not yet known: ${listOut(c.spec.unknowns)}.` : null,
    'If a missing detail would materially change the answer, state the assumption you are making inline and clearly, then continue — do not stall the whole deliverable.',
    'If a detail is missing but would not change the substance, choose the most common case silently and note it once at the end.',
    'Never fabricate specifics (names, figures, dates, citations, prices, APIs) to fill a gap. Mark the gap instead.',
  ]),

  finalRules: (c) => sec('FINAL RESPONSE RULES', [
    'Answer the actual objective, not a nearby easier one.',
    c.flags.copyReady ? 'Produce finished, ready-to-use output — no placeholders other than clearly marked ones the user must fill.' : null,
    ...asBul(c.finalRules),
  ]),

  /* ── domain-specific blocks ── */

  researchSpec: (c) => sec('RESEARCH SPECIFICATION', [
    `Question in scope: ${c.spec.researchQuestion || c.spec.objective}`,
    c.flags.recency ? `Recency window: prioritise material from the last ${c.flags.recency}; label anything older as historical context.` : null,
    `Source standard: ${c.flags.sourceStandard || 'peer-reviewed papers and official documentation first'}; secondary sources only to locate primaries. Exclude content farms, undated pages and unsourced summaries.`,
    'For every source used, record: author or body, year, title, and where it can be found.',
    'Where the literature disagrees, present the disagreement — do not average it away. Note whether disagreement comes from different methods, populations, definitions or dates.',
    'Close with a limitations section: what this review cannot establish, and which question it would be most valuable to research next.',
  ]),

  academicSpec: (c) => sec('ACADEMIC REQUIREMENTS', [
    `Level: ${c.flags.academicLevel || 'final-year undergraduate'}. Match the conventions of that level, not a lower or higher one.`,
    c.flags.citationStyle ? `Citation style: ${c.flags.citationStyle}. Apply it consistently to every reference.` : 'Use a consistent citation style and name it explicitly in your answer.',
    'Structure should be defensible: claim → evidence → reasoning → limitation. Avoid rhetorical padding and unsupported general statements.',
    'Unless explicitly asked for a model answer, write an original treatment of the question — do not reproduce a known textbook passage.',
    'Where a mark scheme exists, every sentence should be traceable to a criterion; where it does not, define the criteria you are targeting before writing.',
    'Flag any place where the honest answer is "the evidence is mixed" rather than inventing certainty.',
  ]),

  teachingSpec: (c) => sec('TEACHING DESIGN', [
    `Start from the learner’s current level and build upward — do not open with advanced material.`,
    'Introduce at most three new concepts before checking understanding.',
    'For each concept: plain-language definition → why it matters → concrete example → common misconception → one quick check question.',
    'Prefer concrete before abstract, and name the analogy’s limits when you use one.',
    'End with a short practice set ordered by difficulty and an answer key separated from the questions.',
  ]),

  codeSpec: (c) => sec('IMPLEMENTATION SPEC', [
    c.flags.language ? `Language and version: ${c.flags.language}.` : 'State the language and version you are targeting before writing code.',
    c.flags.environment ? `Runtime/environment: ${c.flags.environment}.` : null,
    'Define the contract before the body: inputs, outputs, types, edge cases, and error behaviour.',
    'Code must be complete and runnable — no `...` placeholders, no pseudo-code unless explicitly requested, no imports that are not used.',
    c.flags.depsPolicy || 'Prefer the standard library; if a dependency is genuinely warranted, name it, give the version, and say what it replaces.',
    'Handle the failure paths, not just the happy path: invalid input, empty input, network failure, and boundary values.',
    'Match the surrounding codebase’s conventions when existing code is supplied.',
  ]),

  debugSpec: (c) => sec('DEBUGGING SPEC', [
    'Reproduce the fault from the evidence given. State the symptom as an observation, not as a guess at the cause.',
    'Rank candidate causes, then give the single cheapest observation or test that eliminates the most of them.',
    'Fix the root cause; if you must apply a workaround, label it as a workaround and say what remains unresolved.',
    'For every fix, state why it resolves the cause, and the regression to watch for afterwards.',
    'If the supplied evidence is insufficient to diagnose, say exactly what to capture next (log line, minimal reproduction, error output, version) instead of guessing.',
  ]),

  buildSpec: (c) => sec('BUILD SPECIFICATION', [
    'Define the product surface before the implementation: screens or endpoints, states, data model, key interactions, and what happens on failure.',
    c.flags.techStack ? `Stack: ${c.flags.techStack}.` : 'Propose a stack that fits the constraints and justify it in one line.',
    'Non-functional requirements are part of the deliverable: responsive behaviour, accessibility, performance budget, and security boundaries.',
    'Give the file/folder structure first, then the content of each file. State the exact commands to run and how to verify each step worked.',
    'Keep the build runnable at every stage — no half-finished scaffolding left in the tree.',
    'Include the deployment path and any configuration or environment variables required.',
  ]),

  decisionSpec: (c) => sec('DECISION SPECIFICATION', [
    `Options under consideration: ${(c.spec.options?.length ? c.spec.options : ['the options you identify']).join('  vs  ')}.`,
    `Criteria and weights: ${listOut(c.criteria.map((x) => `**${x.name}** (${x.weight})`))}.`,
    'For each option give: the case for it, the case against it, the strongest evidence available, and the assumption it depends on.',
    'Separate what is known from what is assumed. Say explicitly which decision inputs are estimates.',
    'State the recommendation, the confidence level you would honestly attach to it, and the specific, observable condition that would change it.',
    'Note which parts of the decision are reversible, and where the user should move quickly rather than gather more information.',
  ]),

  mediaSpec: (c) => (c.media?.prompt ? sec('PROMPT', [c.media.prompt]) : null),

  mediaControls: (c) => {
    if (!c.media) return null;
    return sec('PARAMETERS', [
      ...asBul(c.media.parameters),
      c.media.aspect ? `Aspect ratio: ${c.media.aspect}.` : null,
      c.media.text ? `Literal text to render: ${c.media.text}` : null,
    ]);
  },

  mediaNegative: (c) => (c.media?.negatives?.length ? sec('NEGATIVE CONSTRAINTS', asBul(c.media.negatives)) : null),

  mediaNotes: (c) => (c.media?.notes?.length ? sec('ADJUSTMENT NOTES', asBul(c.media.notes)) : null),

  agentSpec: (c) => sec('AGENT SPECIFICATION', [
    `Goal: ${c.spec.objective}`,
    `Inputs available: ${listOut(c.spec.inputs.length ? c.spec.inputs : ['as described in CONTEXT'])}.`,
    `Tools and permissions: ${listOut(c.availableTools)}.`,
    `Stages: ${c.chain.join(' → ')}.`,
    `Budget: at most ${c.budget.steps} steps and ${c.budget.retries} retry per failing step. Stop when ${listOut(c.budget.stopConditions)}.`,
    'Decision points: name each point where the plan can branch, the signal that selects the branch, and the default branch when the signal is absent.',
    'Verification: after each action, check the result against the expected effect before continuing.',
    'Failure recovery: on failure, capture the error, retry once with a changed approach, and if it fails again stop and report — including what was attempted, what blocked it, and the best next human action.',
    `Final output: ${c.spec.deliverable || 'the objective’s deliverable, plus a step log and any unresolved questions.'}`,
  ]),

  runbook: (c) => sec('RUNBOOK STEPS', [
    'Present each step as: purpose → exact command or action → expected result → how to tell it worked → what to do if it did not.',
    'State prerequisites and their versions before step one. Never assume a tool exists without saying so.',
    'Mark every step that is destructive or irreversible, and give the safe rollback before it.',
    'Secrets and credentials must never appear in command history, logs or the repository — show the placeholder form only.',
  ]),

  commsSpec: (c) => sec('COMMUNICATION SPEC', [
    `Relationship and context: ${c.flags.relationship || 'as described in CONTEXT'}.`,
    'Lead with the outcome the recipient needs, then the reasoning, then the ask. Assume they read only the first three lines.',
    'Match register to the relationship: warm without being effusive, direct without being blunt.',
    c.flags.avoidSaying?.length ? `Avoid these notes or phrases entirely: ${listOut(c.flags.avoidSaying)}.` : null,
    'Do not over-apologise or pad with pleasantries. One sentence of acknowledgement is enough.',
    'Give one primary version plus a shorter alternative for when brevity matters more than warmth.',
  ]),

  transformSpec: (c) => sec('TRANSFORMATION RULES', [
    'Preserve meaning exactly. You may change wording freely, but not facts, figures, names, causality, certainty or emphasis.',
    'Nothing may be added that was not in the source, and nothing material may be dropped.',
    'Indicate any place where the source was ambiguous and where your rendering had to choose an interpretation.',
    'Return the transformed text only — no commentary, no explanation, unless a notes section is explicitly requested.',
  ]),

  highStakes: (c) => sec('SAFETY AND SCOPE BOUNDARIES', [
    c.flags.domain === 'health'
      ? 'This is health information, not medical care. Do not diagnose, do not prescribe, and do not give dosages. State clearly when symptoms require urgent professional attention.'
      : c.flags.domain === 'legal'
        ? 'This is legal information, not legal advice. Do not assert an outcome as certain. Identify the jurisdiction-dependent parts and say what a licensed practitioner must confirm.'
        : 'This is financial information, not personalised financial advice. Do not promise returns or outcomes. Make the assumptions behind any projection explicit.',
    'Present the general position accurately, then state plainly which parts depend on facts only a professional or the user’s full circumstances can supply.',
    'Give the user the practical next step that reduces risk, including when that step is "ask a qualified professional before acting".',
  ]),

  metaSpec: (c) => sec('GENERATOR SPECIFICATION', [
    'Variables that change between runs are written as {{double_braces}}. List each variable with its purpose, type, whether it is required, and a sensible default.',
    'The generated prompt must itself be self-contained: a reader with no access to this generator must be able to use it successfully.',
    'Include one filled example so the user can see the expected input and a representative result.',
    'Apply a quality gate before returning: check the generated prompt against the criteria in QUALITY CRITERIA and regenerate once if any criterion fails.',
  ]),

  rubricSpec: (c) => sec('MARKING RUBRIC', [
    'Provide the rubric as a table: criterion | what a top answer does | what a weak answer does | marks.',
    'The total must add up exactly to the stated marks, and the criteria must describe observable features of the answer rather than effort.',
    'Add a short "examiner notes" section listing the three mistakes that most often cost marks on this question.',
  ]),
};

/* ─────────────────────────── recipes ─────────────────────────── */

const BASE = ['role', 'mission', 'context', 'objective', 'inputs', 'requirements', 'constraints', 'priorities'];

export const RECIPES = {
  generic: [...BASE, 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],

  qa: ['role', 'mission', 'context', 'objective', 'inputs', 'constraints', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  research: [...BASE, 'researchSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  academic: [...BASE, 'academicSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  teaching: [...BASE, 'teachingSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  exam: [...BASE, 'teachingSpec', 'rubricSpec', 'process', 'quality', 'output', 'edgeCases', 'failure', 'finalRules'],
  prose: [...BASE, 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  transform: ['role', 'mission', 'transformSpec', 'inputs', 'constraints', 'output', 'quality', 'verification', 'edgeCases', 'failure'],
  analytical: [...BASE, 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  decision: [...BASE, 'decisionSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  strategic: [...BASE, 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  engineering: [...BASE, 'codeSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  debug: [...BASE, 'debugSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  runbook: [...BASE, 'runbook', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  build: [...BASE, 'buildSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  agent: [...BASE, 'agentSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  image: ['mediaSpec', 'mediaNegative', 'mediaControls', 'mediaNotes'],
  video: ['mediaSpec', 'mediaNegative', 'mediaNotes'],
  audio: [...BASE, 'process', 'quality', 'output', 'edgeCases', 'failure'],
  interactive: ['role', 'mission', 'context', 'objective', 'constraints', 'process', 'quality', 'output', 'edgeCases', 'failure', 'finalRules'],
  comms: [...BASE, 'commsSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  highStakes: [...BASE, 'highStakes', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  meta: [...BASE, 'metaSpec', 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
  slides: [...BASE, 'process', 'quality', 'verification', 'output', 'edgeCases', 'failure', 'finalRules'],
};

/** Category id → recipe id. Explicit, reviewable, and easy to extend. */
export const CATEGORY_RECIPE = {
  'general-qa': 'qa', mathematics: 'qa', science: 'qa',
  research: 'research', 'web-research': 'research',
  academic: 'academic',
  learning: 'teaching', 'exam-prep': 'exam',
  writing: 'prose', rewriting: 'prose', editing: 'prose',
  'creative-writing': 'prose', storytelling: 'prose',
  translation: 'transform', summarization: 'transform',
  analysis: 'analytical', comparison: 'analytical', 'data-analysis': 'analytical',
  decision: 'decision', career: 'decision', finance: 'highStakes',
  planning: 'strategic', productivity: 'strategic', 'project-management': 'strategic',
  travel: 'strategic', business: 'strategic', entrepreneurship: 'strategic',
  marketing: 'strategic', seo: 'strategic', 'social-media': 'strategic',
  presentation: 'slides', document: 'build',
  coding: 'engineering', architecture: 'engineering', engineering: 'engineering',
  'ai-development': 'engineering', 'data-viz': 'engineering', spreadsheet: 'engineering',
  debugging: 'debug',
  devops: 'runbook', automation: 'runbook',
  'security-review': 'runbook',
  website: 'build', 'app-development': 'build', 'game-dev': 'build', 'ui-ux': 'build',
  'agent-design': 'agent',
  'prompt-engineering': 'meta', 'meta-prompting': 'meta',
  'image-generation': 'image', 'image-editing': 'image',
  'video-generation': 'video',
  audio: 'audio',
  roleplay: 'interactive', simulation: 'interactive', brainstorming: 'interactive',
  communication: 'comms',
  legal: 'highStakes', health: 'highStakes',
  resume: 'comms', 'interview-prep': 'interactive',
  other: 'generic',
};

export function recipeFor(categoryId, flags = {}) {
  if (flags.media === 'image') return RECIPES.image;
  if (flags.media === 'video') return RECIPES.video;
  const recipeId = CATEGORY_RECIPE[categoryId] || 'generic';
  return RECIPES[recipeId] || RECIPES.generic;
}

export function recipeIdFor(categoryId, flags = {}) {
  if (flags.media === 'image') return 'image';
  if (flags.media === 'video') return 'video';
  return CATEGORY_RECIPE[categoryId] || 'generic';
}

/**
 * Build the numbered section list for a prompt.
 *
 * Each section carries its builder `id` and, where applicable, the techniques
 * whose rendered instructions landed inside it. That metadata is what makes
 * provenance reporting possible — nothing is added to the prompt text itself.
 *
 * @returns {Array<{id:string, title:string, lines:string[], from:string[]}>}
 */
export function buildSections(ctx) {
  const ids = recipeFor(ctx.primary.id, ctx.flags);
  const out = [];
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const builder = SECTIONS[id];
    if (!builder) continue;
    const s = builder(ctx);
    if (s) out.push({ id, from: sourceFor(id, ctx), ...s });
  }
  return out;
}

/** Which part of the engine is responsible for each section. */
function sourceFor(id, ctx) {
  const selected = ctx.selected || [];
  switch (id) {
    case 'process': return contributors(sourceFamilies(selected, ['process', 'reasoning']), 'technique');
    case 'verification': return contributors(sourceFamilies(selected, ['evaluation']).filter((t) => t.id !== 'rubric'), 'technique');
    case 'quality': return ['rubric-based evaluation (checks: content quality)', 'extracted brief (the task’s own standard)'];
    case 'researchSpec': case 'academicSpec': case 'teachingSpec': case 'codeSpec': case 'debugSpec':
    case 'buildSpec': case 'decisionSpec': case 'commsSpec': case 'highStakes': case 'metaSpec':
    case 'agentSpec': case 'runbook': case 'transformSpec':
      return ['archetype recipe (domain section library)', 'extracted brief (audience, level, constraints)'];
    case 'mediaSpec': case 'mediaNegative': case 'mediaControls': case 'mediaNotes':
      return ['media-prompt builder (composition stack for image/video models)'];
    case 'rubricSpec': return ['marking-rubric structure (exam archetype)'];
    case 'failure': return ['extraction (unknowns)', 'adversarial review (missing-information rule)'];
    case 'finalRules': return ctx.repairs?.length
      ? ['adversarial review — repaired failure modes', 'always-on output discipline rules']
      : ['always-on output discipline rules'];
    case 'edgeCases': return ['edge-case generator (per task class)'];
    case 'constraints': case 'requirements': case 'objective': case 'context': case 'inputs': case 'mission':
      return ['request extractor (your own words, structured)'];
    case 'priorities': return ctx.spec?.conflicts?.length
      ? ['conflict detector (tension found in your brief)']
      : ['static priority order'];
    case 'role': return ['taxonomy default role for this task class', 'capability gating against the target profile'];
    case 'output': return ['output-format engine (archetype default for this task class)'];
    default: return ['section library'];
  }
}

function sourceFamilies(selected, families) {
  return selected.filter((t) => families.includes(t.family));
}

function contributors(techniques, kind) {
  if (!techniques.length) return [`${kind}: none required for this task`];
  return techniques.map((t) => `${kind}: ${t.label}${t.id === 'rubric' ? '' : ''}`);
}

/** Distinct section titles across all recipes — used by the test-suite. */
export function sectionTitles() {
  return unique(Object.keys(SECTIONS));
}
