/**
 * PromptNexus — public API.
 *
 *   import { architect } from 'promptnexus';
 *   const r = architect('I need a prompt to help me revise for my DBMS exam');
 *   console.log(r.prompt);
 *
 * Zero dependencies. Runs in Node 18+ and in the browser (ESM).
 */

export { generate, explain, errorResult } from './pipeline/engine.mjs';
export { analyzePrompt, compressPrompt, translatePrompt, testPrompt, comparePrompts, splitPromptPair } from './pipeline/promptanalysis.mjs';
export { detectModes, MODES } from './pipeline/modes.mjs';
export { evaluate, metricsFor, METRIC_LABELS } from './pipeline/evaluate.mjs';
export { classifyCategories, detectTarget, detectIntent, assessComplexity } from './pipeline/classify.mjs';
export { extractSpec } from './pipeline/extract.mjs';
export { selectTechniques, deriveFlags, deriveStrategyPayload } from './pipeline/strategy.mjs';
export { scorePrompt, qualityControl } from './pipeline/score.mjs';
export { buildPrompt, buildMediaPrompt } from './pipeline/build.mjs';
export { renderPrompt, chunkPrompt } from './pipeline/render.mjs';
export { TAXONOMY, CATEGORY_INDEX } from './knowledge/taxonomy.mjs';
export { TARGETS, TARGET_INDEX, resolveTarget, can } from './knowledge/targets.mjs';
export { TECHNIQUES, TECHNIQUE_INDEX } from './knowledge/techniques.mjs';
export { MODES as MODE_LIST } from './pipeline/modes.mjs';

import { generate } from './pipeline/engine.mjs';

/**
 * Friendly entry point used by the CLI, the web app and the tests.
 * @param {string} input free-form request
 * @param {{targetId?:string, answers?:object, advanced?:boolean, minimal?:boolean, variants?:boolean, workflow?:boolean}} [options]
 */
export function architect(input, options = {}) {
  return generate(input, options);
}

/** Compact text rendering — the shape the CLI prints by default. */
export function toText(result, { minimal = false } = {}) {
  if (result.error) return result.error;
  if (minimal) return result.prompt || '';

  const out = [];
  out.push(`🎯 UNDERSTOOD GOAL\n${result.goal}`);
  if (result.strategy?.summary) out.push(`\n🧠 STRATEGY\n${result.strategy.summary}`);
  out.push(`\n📋 FINAL PROMPT\n${result.prompt}`);
  if (result.customization?.length) {
    out.push(`\n⚙️ CUSTOMIZATION`);
    for (const c of result.customization) out.push(`  • ${c.field}: ${c.value}`);
  }
  if (result.score) {
    out.push(`\n📊 QUALITY SCORE\n${result.score.total}/100 — ${result.score.verdict}`);
    if (result.score.levers?.length) out.push(`  Improve further: ${result.score.levers.join(' ')}`);
  }
  if (result.openQuestions?.length) {
    out.push(`\n❓ WOULD HELP (optional)`);
    for (const q of result.openQuestions) out.push(`  • ${q.question} [${q.options.join(' / ')}]`);
  }
  if (result.warnings?.length) {
    out.push(`\n⚠️ NOTES`);
    for (const w of result.warnings) out.push(`  • ${w}`);
  }
  return out.join('\n');
}

export default { architect, generate, toText };
