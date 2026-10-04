/**
 * Evaluation composition layer.
 *
 * The engine already exposes structural analysis (`analyzePrompt`) and pairwise
 * comparison (`comparePrompts`). The product surfaces a specific seven-metric
 * vocabulary, so this module *derives* those seven numbers from the engine's
 * real diagnostics — it does not invent scores.
 *
 * Every metric maps to checks the analyser actually performs. Where a metric
 * needs a composite, the formula is written out below so it can be audited.
 */

import { analyzePrompt, comparePrompts } from './promptanalysis.mjs';

const has = (d, id) => d.checks.includes(id);

/** Completeness: does the prompt carry the parts a brief needs to succeed? */
function completeness(d) {
  const parts = [
    ['objective', 20], ['context', 18], ['outputFormat', 20],
    ['constraints', 14], ['length', 10], ['scope', 10], ['audience', 8],
  ];
  const earned = parts.reduce((sum, [id, weight]) => sum + (has(d, id) ? weight : 0), 0);
  return clamp(Math.round(earned));
}

/** Hallucination resistance: the safeguards that stop confident invention. */
function hallucinationResistance(d) {
  let score = 26;
  if (has(d, 'uncertainty')) score += 26;
  if (has(d, 'verification')) score += 18;
  if (has(d, 'injection')) score += 14;
  if (has(d, 'delimiters')) score += 8;
  if (has(d, 'edgeCases')) score += 8;
  return clamp(score);
}

function clamp(n) {
  return Math.max(0, Math.min(100, n));
}

/** Map one prompt's diagnostics onto the seven product metrics. */
export function metricsFor(text) {
  const d = analyzePrompt(text);
  const m = {
    clarity: d.dimensionScores.clarity,
    completeness: completeness(d),
    robustness: d.dimensionScores.robustness,
    constraintAdherence: d.dimensionScores.constraints,
    outputQuality: Math.round((d.dimensionScores.specificity + d.dimensionScores.outputControl) / 2),
    hallucinationResistance: hallucinationResistance(d),
    targetCompatibility: d.dimensionScores.modelCompatibility,
  };
  m.overall = Math.round(Object.values(m).reduce((a, b) => a + b, 0) / Object.keys(m).length);
  return { metrics: m, diagnostics: d };
}

export const METRIC_LABELS = {
  clarity: 'Clarity',
  completeness: 'Completeness',
  robustness: 'Robustness',
  constraintAdherence: 'Constraint adherence',
  outputQuality: 'Output control',
  hallucinationResistance: 'Hallucination resistance',
  targetCompatibility: 'Target compatibility',
  overall: 'Overall',
};

/** Notes explain *why* a number is what it is, from the analyser's own findings. */
function notesFor(d, metrics) {
  const notes = [];
  if (metrics.clarity < 70) notes.push(d.vagueWords.length
    ? `Vague qualifiers present (${d.vagueWords.slice(0, 4).join(', ')}).`
    : 'Sentences are long or mixed; instructions are easier to follow one per line.');
  if (metrics.completeness < 70) {
    const missing = ['objective', 'context', 'outputFormat', 'constraints', 'length', 'scope']
      .filter((id) => !has(d, id));
    if (missing.length) notes.push(`Missing: ${missing.join(', ').replace(/([A-Z])/g, ' $1').toLowerCase()}.`);
  }
  if (metrics.constraintAdherence < 70) notes.push('Few hard boundaries — the model chooses length, scope and format for you.');
  if (metrics.hallucinationResistance < 70) notes.push('No instruction to label assumptions or refuse to invent specifics.');
  if (metrics.robustness < 70) notes.push('Nothing tells the model what to do with empty, odd or oversized input.');
  if (d.weaknesses.length) notes.push(`${d.weaknesses.length} structural weakness${d.weaknesses.length > 1 ? 'es' : ''} detected.`);
  return notes.slice(0, 4);
}

/**
 * Evaluate one or more prompts and rank them.
 * @param {Array<{label?:string, text:string}>} prompts
 */
export function evaluate(prompts) {
  const items = prompts
    .filter((p) => p && String(p.text || '').trim())
    .map((p, i) => {
      const { metrics, diagnostics } = metricsFor(p.text);
      return {
        label: p.label || `Prompt ${String.fromCharCode(65 + i)}`,
        index: i,
        text: p.text,
        metrics,
        notes: notesFor(diagnostics, metrics),
        stats: diagnostics.stats,
        strengths: diagnostics.strengths,
        weaknesses: diagnostics.weaknesses.map((w) => ({ label: w.label, severity: w.severity })),
        failurePreview: null,
      };
    });

  if (!items.length) return { items: [], winner: null, verdict: 'Nothing to evaluate yet.' };

  const best = (key) => Math.max(...items.map((i) => i.metrics[key]));
  const leaders = {};
  for (const key of Object.keys(items[0].metrics)) {
    leaders[key] = items.filter((i) => i.metrics[key] === best(key)).map((i) => i.label);
  }

  const ranked = [...items].sort((a, b) => b.metrics.overall - a.metrics.overall);
  const top = ranked[0];
  const runnerUp = ranked[1];

  let verdict;
  if (!runnerUp) {
    verdict = `${top.label} scores ${top.metrics.overall}/100 on specification quality.`;
  } else if (top.metrics.overall - runnerUp.metrics.overall <= 3) {
    verdict = `${top.label} and ${runnerUp.label} are within ${top.metrics.overall - runnerUp.metrics.overall} points — take the shorter one and port across any safeguard the other has.`;
  } else {
    const gaps = Object.keys(top.metrics)
      .filter((k) => k !== 'overall' && top.metrics[k] - runnerUp.metrics[k] >= 12)
      .sort((a, b) => (top.metrics[b] - runnerUp.metrics[b]) - (top.metrics[a] - runnerUp.metrics[a]));
    verdict = `${top.label} is stronger overall (${top.metrics.overall} vs ${runnerUp.metrics.overall}).`;
    if (gaps.length) verdict += ` Biggest margins: ${gaps.slice(0, 2).map((g) => `${METRIC_LABELS[g]} +${top.metrics[g] - runnerUp.metrics[g]}`).join(', ')}.`;
  }

  // For exactly two prompts the engine's pairwise comparison adds dimension-level reasons.
  let pairwise = null;
  if (items.length === 2) {
    const cmp = comparePrompts(items[0].text, items[1].text, { labelA: items[0].label, labelB: items[1].label });
    pairwise = {
      winner: cmp.winner,
      reasons: cmp.reasons,
      uniqueToA: cmp.uniqueToA,
      uniqueToB: cmp.uniqueToB,
      mergeAdvice: cmp.uniqueToA.length || cmp.uniqueToB.length
        ? `Port ${cmp.uniqueToA.length ? `${items[0].label}’s ${cmp.uniqueToA.join(', ')}` : ''}${cmp.uniqueToA.length && cmp.uniqueToB.length ? ' and ' : ''}${cmp.uniqueToB.length ? `${items[1].label}’s ${cmp.uniqueToB.join(', ')}` : ''} into the version you keep.`
        : null,
    };
  }

  return {
    items,
    winners: leaders,
    ranked: ranked.map((r) => ({ label: r.label, overall: r.metrics.overall })),
    winner: top.label,
    winnerIndex: top.index,
    verdict,
    pairwise,
    calibration: 'Structural analysis of the prompt text — it measures how well-specified a prompt is, not what a model would output. No model is invoked.',
  };
}
