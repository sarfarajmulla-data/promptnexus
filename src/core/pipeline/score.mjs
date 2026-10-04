/**
 * Quality control + hardness score.
 *
 * Runs after construction: checks the *actual assembled prompt* against the
 * quality dimensions, then scores it. The score is deliberately conservative —
 * it is a measure of the prompt's specification quality, not a prediction of
 * model output, and the report says so. Inflated scores are worse than useless.
 */

import { estimateTokens, countWords, listOut, clamp, unique } from '../util/text.mjs';

const IDEAL_TOKENS = { 1: [120, 480], 2: [280, 760], 3: [500, 1150], 4: [750, 1650], 5: [900, 2200] };

/** Structural quality-control checks (master spec §12). */
export function qualityControl(ctx) {
  const s = ctx.sections || [];
  const titles = new Set(s.map((x) => x.title));
  const body = s.map((x) => x.lines.join('\n')).join('\n');
  const tokens = estimateTokens(ctx.prompt || '');
  const checks = [];

  const add = (id, label, pass, note) => checks.push({ id, label, pass, note });

  const numbers = (body.match(/\b\d[\d,.]*\b/g) || []).length;
  add('specificity', 'Specificity', numbers >= 4 || ctx.selected.length >= 3,
    numbers >= 4 ? `${numbers} concrete figures/limits in the prompt.` : 'Few concrete numbers — much of the specification is qualitative.');

  add('context', 'Context', (ctx.spec.context.length >= 1 && Boolean(ctx.spec.audience || ctx.spec.selfContext)) || ctx.complexity.level <= 1,
    ctx.spec.context.length ? `Context supplied (${ctx.spec.context.length} item${ctx.spec.context.length > 1 ? 's' : ''})${ctx.spec.audience ? ` and audience named (${ctx.spec.audience})` : ''}.` : 'No situational context could be extracted — the prompt works from the brief alone.');

  add('completeness', 'Completeness', ctx.spec.requirements.must.length + ctx.spec.requirements.should.length > 0,
    `${ctx.spec.requirements.must.length} MUST and ${ctx.spec.requirements.should.length} SHOULD requirements encoded.`);

  const ambiguousLeft = ctx.spec.unknowns.length > 3;
  add('precision', 'Precision', !ambiguousLeft,
    ambiguousLeft ? `${ctx.spec.unknowns.length} unknowns remain, which leaves room for divergent interpretations.` : 'Ambiguity is either resolved or explicitly flagged as an assumption.');

  const badTools = (ctx.availableTools || []).some((t) => /none beyond/.test(t)) === false && !ctx.flags.targetHasTools && !ctx.flags.targetHasSearch;
  add('feasibility', 'Feasibility', !badTools,
    badTools ? 'A tool step was requested but the target profile lists no such capability — it has been softened to a stated limitation.' : `Requested actions are within the target profile (${ctx.target.label}).`);

  add('outputControl', 'Output control', titles.has('OUTPUT FORMAT') || Boolean(ctx.flags.media) || ctx.flags.wantsAnswerOnly,
    titles.has('OUTPUT FORMAT') ? 'Output shape, structure and length are pinned.' : 'No explicit output section — the format is described inline.');

  add('robustness', 'Robustness', ctx.flags.media ? Boolean(ctx.media?.negatives?.length) : robustSignals(ctx) >= 3,
    ctx.flags.media
      ? (ctx.media?.negatives?.length ? `${ctx.media.negatives.length} explicit exclusions and ${ctx.media?.parameters?.length || 0} parameter controls supplied.` : 'No exclusions supplied — output artefacts will need manual retries.')
      : `${robustSignals(ctx)} of 5 robustness safeguards present (delimiters, injection defence, edge cases, missing-info rule, uncertainty marking).`);

  const [lo, hi] = IDEAL_TOKENS[ctx.complexity.level] || IDEAL_TOKENS[2];
  add('efficiency', 'Efficiency', tokens <= hi * 1.35,
    tokens > hi * 1.35 ? `~${tokens} tokens is long for a level-${ctx.complexity.level} task (target ≤ ${hi}).` : `~${tokens} tokens for a level-${ctx.complexity.level} task — proportionate.`);

  add('hallucination', 'Hallucination resistance', ctx.flags.media ? true : /never (?:invent|fabricate)|do not (?:invent|fabricate)|assumption|unknown/i.test(body),
    /never (?:invent|fabricate)/i.test(body) ? 'The prompt explicitly forbids fabricated specifics.' : 'Uncertainty handling is present but not stated as a fabrication ban.');

  add('verification', 'Verification', ctx.flags.media ? true : (ctx.selected.some((t) => t.family === 'evaluation') || ctx.complexity.level <= 1),
    ctx.flags.media
      ? 'Media output is verified by inspection; the prompt instead constrains exclusions and parameters.'
      : ctx.selected.some((t) => t.family === 'evaluation') ? 'A verification step is built into the process.' : 'No verification step — acceptable for a single-step task.');

  add('usefulness', 'Real-world usefulness', Boolean(ctx.spec.deliverable),
    ctx.spec.deliverable ? `Deliverable is named: ${ctx.spec.deliverable}.` : 'Deliverable is implied rather than named.');

  add('targetFit', 'Technical correctness for target', capabilityConsistent(ctx),
    capabilityConsistent(ctx) ? `Instructions respect ${ctx.target.label}'s listed capabilities${ctx.target.verified ? '' : ' (profile is a design assumption, not a capability claim).'}` : 'Some instructions assume capabilities the profile does not list.');

  return checks;
}

function robustSignals(ctx) {
  const body = (ctx.sections || []).map((x) => x.lines.join('\n')).join('\n');
  let n = 0;
  if (/delimiter|```|<\w+>|BEGIN|```/i.test(body)) n++;
  if (/instructions embedded|never as instructions|outrank/i.test(body)) n++;
  if (/edge case|empty|missing input|not provided/i.test(body)) n++;
  if (/missing detail|assumption|if .* is not (?:known|provided)/i.test(body)) n++;
  if (/\[Verified\]|\[Assumption\]|uncertain|confidence/i.test(body)) n++;
  return n;
}

function capabilityConsistent(ctx) {
  const body = JSON.stringify(ctx.sections || []);
  if (/\bsearch the web\b|\bbrowse the web\b/i.test(body) && !ctx.flags.targetHasSearch) return false;
  if (/\bcall (?:the|a) tool\b/i.test(body) && !ctx.flags.targetHasTools) return false;
  if (/\brun the code\b/i.test(body) && !ctx.target.caps.codeExec && ctx.primary.id !== 'coding') return false;
  return true;
}

/* ───────────────────────── hardness score ───────────────────────── */

const DIMENSION_INFO = {
  specificity: 'How precisely the prompt defines what should happen.',
  contextQuality: 'Whether the target has the situational information it cannot infer.',
  domainKnowledge: 'Depth of domain-specific instruction and conventions encoded.',
  complexity: 'Whether prompt weight matches task weight — neither thin nor bloated.',
  problemSolving: 'Process structure, decomposition and problem-solving scaffolding.',
  creativity: 'Room and method for original, non-generic output where the task needs it.',
  technicalAccuracy: 'Instructions are technically sound and capability-consistent.',
  applicability: 'The result can be used in the real situation, not just admired.',
  constraintClarity: 'Constraints, exclusions and priority order are unambiguous.',
  outputPrecision: 'The output contract is exact: shape, length, structure.',
  verificationStrength: 'Built-in checking, uncertainty marking and evidence discipline.',
  robustness: 'Survives odd, empty, huge, adversarial or misaligned inputs.',
};

const WEIGHTS_BY_GROUP = {
  engineering: { technicalAccuracy: 1.6, outputPrecision: 1.4, specificity: 1.3, applicability: 1.3, verificationStrength: 1.3 },
  academic: { verificationStrength: 1.6, domainKnowledge: 1.4, specificity: 1.3, constraintClarity: 1.3, contextQuality: 1.2 },
  knowledge: { verificationStrength: 1.5, contextQuality: 1.3, applicability: 1.2, specificity: 1.2 },
  creative: { creativity: 1.8, specificity: 1.2, constraintClarity: 1.2, applicability: 1.2 },
  business: { applicability: 1.5, problemSolving: 1.4, specificity: 1.3, verificationStrength: 1.2 },
  media: { outputPrecision: 1.8, specificity: 1.5, creativity: 1.3, applicability: 1.3 },
  'high-stakes': { verificationStrength: 1.9, robustness: 1.5, applicability: 1.3, constraintClarity: 1.3 },
  life: { applicability: 1.6, problemSolving: 1.3, complexity: 1.2, robustness: 1.2 },
  communication: { applicability: 1.4, creativity: 1.3, specificity: 1.3, constraintClarity: 1.2 },
  product: { technicalAccuracy: 1.4, outputPrecision: 1.3, specificity: 1.3, robustness: 1.2 },
  default: {},
};

export function scorePrompt(ctx) {
  const s = ctx.sections || [];
  const body = s.map((x) => x.lines.join('\n')).join('\n');
  const titles = new Set(s.map((x) => x.title));
  const tokens = estimateTokens(ctx.prompt || '');
  const numbers = (body.match(/\b\d[\d,.]*\b/g) || []).length;
  const mustCount = ctx.spec.requirements.must.length;
  const negCount = (body.match(/\b(?:never|do not|don’t|don'?t|avoid|must not|without)\b/gi) || []).length;
  const checks = qualityControl(ctx);
  const passed = checks.filter((c) => c.pass).length / checks.length;

  const [lo, hi] = IDEAL_TOKENS[ctx.complexity.level] || IDEAL_TOKENS[2];
  const complexityFit = tokens < lo ? clamp(60 + (tokens / lo) * 40, 20, 100)
    : tokens > hi ? clamp(100 - ((tokens - hi) / hi) * 60, 30, 100)
      : 100;

  const robustnessCount = robustSignals(ctx);

  const dims = {
    specificity: clamp(48 + Math.min(24, numbers * 3.2) + Math.min(14, mustCount * 3) + (titles.has('OUTPUT FORMAT') ? 10 : 0) + ctx.selected.length * 1.4, 10, 98),
    contextQuality: clamp(
      (!ctx.flags.media ? 40 : 60)
      + Math.min(20, ctx.spec.context.length * 7)
      + (ctx.spec.audience ? 12 : 0)
      + (ctx.spec.selfContext ? 8 : 0)
      + (ctx.flags.hasSourceText ? 8 : 0)
      + (ctx.spec.inputs.length ? 6 : 0), 10, 98),
    domainKnowledge: clamp(46 + (ctx.template !== 'generic' ? 16 : 0) + Math.min(18, (ctx.primary.must?.length || 0) * 3.4) + (ctx.spec.techStack.length ? 8 : 0) + (ctx.flags.academicLevel ? 8 : 0) + (ctx.selected.some((t) => t.family === 'media') ? 10 : 0), 10, 97),
    complexity: Math.round(clamp(complexityFit, 20, 100)),
    problemSolving: clamp(42 + (titles.has('PROCESS') ? 22 : 0) + (titles.has('VERIFICATION') ? 14 : 0) + (ctx.planStages.length >= 4 ? 10 : 0) + (ctx.qualityGateApplied ? 6 : 0), 10, 98),
    creativity: ctx.primary.creative || (ctx.categories?.secondary || []).some((c) => c.creative)
      ? clamp(50 + (ctx.selected.some((t) => t.id === 'branchSelect' || t.id === 'generationFiltering') ? 22 : 0) + (ctx.selected.some((t) => t.id === 'examples' || t.id === 'fewShot') ? 12 : 0) + (ctx.quantityTarget ? 8 : 0) + (ctx.filterCriteria ? 8 : 0), 20, 97)
      : clamp(72 + (ctx.selected.some((t) => t.family === 'media') ? 8 : 0), 50, 88),
    technicalAccuracy: clamp(60 + (capabilityConsistent(ctx) ? 18 : -14) + (negCount >= 2 ? 8 : 0) + (ctx.spec.conflicts.length ? 6 : 0) + (ctx.target.verified ? 4 : 2), 15, 97),
    applicability: clamp(50 + (ctx.spec.deliverable ? 16 : 0) + Math.min(16, ctx.spec.constraints.length * 5) + (titles.has('OUTPUT FORMAT') ? 10 : 0) + (ctx.flags.copyReady ? 6 : 0), 15, 98),
    constraintClarity: clamp(42 + Math.min(22, mustCount * 6) + Math.min(14, negCount * 4) + (titles.has('PRIORITIES WHEN REQUIREMENTS CONFLICT') ? 12 : 0) + (ctx.spec.forbidden.length ? 8 : 0), 15, 98),
    outputPrecision: clamp((ctx.flags.media ? 74 : 40) + (titles.has('OUTPUT FORMAT') ? 26 : 0) + (ctx.schema ? 14 : 0) + (ctx.flags.wantsMachine ? 10 : 0) + (ctx.spec.lengthTarget ? 8 : 0), 15, 98),
    verificationStrength: ctx.flags.media
      ? Math.round(clamp(54 + (ctx.media?.negatives?.length ? 8 : 0) + (ctx.media?.parameters?.length ? 8 : 0) + (ctx.media?.notes?.length ? 6 : 0), 40, 82))
      : clamp(36 + (ctx.selected.some((t) => t.family === 'evaluation') ? 24 : 0) + (ctx.selected.some((t) => t.id === 'uncertaintyCalibration') ? 14 : 0) + (ctx.selected.some((t) => t.id === 'citationRules' || t.id === 'factCheck') ? 14 : 0) + (titles.has('VERIFICATION') ? 10 : 0) + (ctx.flags.needsVerification ? 4 : 0), 10, 98),
    robustness: ctx.flags.media
      ? Math.round(clamp(50 + Math.min(20, (ctx.media?.negatives?.length || 0) * 3) + (ctx.media?.parameters?.length ? 8 : 0) + (ctx.media?.subjectDetected ? 10 : 0), 35, 90))
      : clamp(28 + robustnessCount * 11 + (ctx.spec.edgeCasesAdded ? 6 : 0) + (ctx.flags.highStakes ? 6 : 0), 10, 97),
  };

  const weights = { ...WEIGHTS_BY_GROUP[ctx.primary.group] || {}, ...WEIGHTS_BY_GROUP.default };
  let num = 0, den = 0;
  const dimensions = Object.entries(dims).map(([key, score]) => {
    const w = weights[key] || 1;
    num += score * w;
    den += w;
    return { key, name: humanise(key), score: Math.round(score), weight: Number(w.toFixed(2)), note: DIMENSION_INFO[key] };
  });

  const total = Math.round(num / den);

  const weaknesses = dimensions.filter((d) => d.score < 62).sort((a, b) => a.score - b.score)
    .map((d) => `${d.name} (${d.score}) — ${d.note}`);

  const levers = buildLevers(ctx, dims, checks);

  const verdict = total >= 85 ? 'Strong: this prompt is specific, verified and right-sized for the task.'
    : total >= 72 ? 'Solid: reliable for the stated objective, with a few refinements available.'
      : total >= 58 ? 'Usable: it will produce usable output, but the weakest dimensions below will show up in the result.'
        : 'Weak: the prompt under-specifies the task; treat the scores below as the fix list.';

  return {
    total,
    band: total >= 85 ? 'strong' : total >= 72 ? 'solid' : total >= 58 ? 'usable' : 'weak',
    dimensions,
    checks,
    passedChecks: `${checks.filter((c) => c.pass).length}/${checks.length}`,
    weaknesses,
    levers,
    verdict,
    tokens,
    calibration: 'Specification quality of the prompt — not a prediction of model output. Scored conservatively; a perfect 100 is not achievable by construction.',
  };
}

function buildLevers(ctx, dims, checks) {
  const levers = [];
  const failing = checks.filter((c) => !c.pass);
  for (const f of failing.slice(0, 2)) levers.push(`${f.label}: ${f.note}`);
  if (dims.contextQuality < 72 && !ctx.spec.audience) levers.push('Name the audience explicitly — it is the highest-leverage missing detail for output quality.');
  if (dims.outputPrecision < 72) levers.push('Pin the output contract further: exact structure, length and what must not appear.');
  if (dims.robustness < 70) levers.push('Add the missing-input rule: say what to do when a required detail is absent instead of inventing it.');
  if (dims.verificationStrength < 70 && ctx.flags.needsVerification) levers.push('Add a verification step appropriate to the domain (recompute, cross-check, or test the fix).');
  return unique(levers).slice(0, 3);
}

function humanise(k) {
  return k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace('Quality', ' quality').replace('Accuracy', ' accuracy').replace('Clarity', ' clarity').trim();
}

export { IDEAL_TOKENS };
