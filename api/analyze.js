/**
 * POST /api/analyze
 *
 * Prompt tooling. `action` selects the operation; the engine does the work.
 *
 *   improve    diagnose a prompt and rebuild it stronger
 *   expand     add only what is missing
 *   compress   keep every constraint, cut the filler
 *   test       predict the eight canonical failure scenarios, then harden
 *   translate  restructure for a different model family
 *   compare    rank up to three prompts across the product's seven metrics
 *   score      diagnostics only
 *
 * Anything the user pastes is treated as data to analyse, never as instructions
 * to this service — the engine strips and reports override attempts.
 */

import { architect, analyzePrompt, compressPrompt, testPrompt, translatePrompt } from '../src/core/index.mjs';
import { resolveTarget } from '../src/core/knowledge/targets.mjs';
import { evaluate, METRIC_LABELS } from './_lib/evaluate.js';
import { handler, readBody, requirePost, httpError, VERSION } from './_lib/http.js';

const ACTIONS = new Set(['improve', 'expand', 'compress', 'test', 'translate', 'compare', 'score', 'evaluate']);

export default handler(async (req, res, meta) => {
  requirePost(req);
  const body = readBody(req);

  const action = String(body.action || 'improve').toLowerCase();
  if (!ACTIONS.has(action)) {
    throw httpError(400, `Unknown action "${action}".`, `Supported: ${[...ACTIONS].join(', ')}.`);
  }

  const prompt = String(body.prompt ?? body.input ?? '').trim();
  const prompts = normalisePrompts(body, prompt);

  if (!prompt && !prompts.length) {
    throw httpError(400, 'Paste a prompt to work on.', 'Send { "prompt": "…", "action": "improve" }.');
  }

  switch (action) {
    case 'compress': {
      const r = compressPrompt(prompt);
      return finish({ action, original: { prompt, stats: analyzePrompt(prompt).stats }, compressed: r }, meta);
    }

    case 'test': {
      const r = testPrompt(prompt);
      return finish({
        action,
        original: { prompt, stats: analyzePrompt(prompt).stats },
        resiliency: r.resiliency,
        scenarios: r.scenarios,
        risks: r.risks,
        diagnostics: r.diagnostics.dimensionScores,
        // Hardening is an explicit follow-up (`action: "improve"`) rather than a
        // silently rewritten prompt: the user sees the risks first, then chooses.
        hardenWith: { action: 'improve', prompt: prompt },
      }, meta);
    }

    case 'translate': {
      const targetId = String(body.targetId || 'claude');
      const { target, unknown, requested } = resolveTarget(targetId);
      if (unknown) throw httpError(400, `Unknown target model "${requested}".`, 'Pick a target from GET /api/targets.');
      const tr = translatePrompt(prompt, target);
      const after = analyzePrompt(tr.text);
      return finish({
        action,
        original: { prompt, stats: after.stats },
        prompt: tr.text,
        note: tr.note,
        target: { id: target.id, label: target.label },
        score: { total: after.dimensionScores.overall, dimensions: after.dimensionScores },
        remaining: after.missing,
      }, meta);
    }

    case 'compare':
    case 'evaluate': {
      const list = prompts.length >= 2 ? prompts : (prompts.length === 1 ? prompts : [{ label: 'Prompt A', text: prompt }]);
      const result = evaluate(list);
      result.metricLabels = METRIC_LABELS;
      return finish({ action: 'compare', ...result }, meta);
    }

    case 'score': {
      const d = analyzePrompt(prompt);
      return finish({ action, prompt, ...d }, meta);
    }

    case 'improve':
    case 'expand':
    default: {
      const verb = action === 'expand' ? 'expand' : 'improve';
      // Users paste the wrapper too ("Improve this prompt: …"). Strip it before
      // wrapping, or the engine ends up improving an instruction about improving.
      const inner = prompt.replace(/^\s*(?:improve|rewrite|expand|compress|fix|optimi[sz]e)\s+this\s+prompt\s*:?\s*/i, '').trim() || prompt;
      const r = architect(`${verb} this prompt:\n\n${inner}`, {
        targetId: body.targetId || undefined,
        variants: body.variants !== false,
        advanced: Boolean(body.advanced),
      });
      if (r.error) throw httpError(422, r.error);
      return finish(r, meta);
    }
  }
});

function finish(payload, meta) {
  return { ...payload, meta: { ms: Date.now() - meta.started, version: VERSION, engine: 'deterministic-local' } };
}

/** Accept either an array of prompts or the shorthand a/b(/c) fields. */
function normalisePrompts(body, single) {
  if (Array.isArray(body.prompts)) {
    return body.prompts
      .map((p, i) => ({
        label: typeof p?.label === 'string' ? p.label.slice(0, 40) : `Prompt ${String.fromCharCode(65 + i)}`,
        text: String(p?.text ?? p ?? '').trim(),
      }))
      .filter((p) => p.text)
      .slice(0, 3);
  }
  const out = [];
  if (single) out.push({ label: 'Prompt A', text: single });
  for (const key of ['b', 'c']) {
    const value = String(body[key] ?? '').trim();
    if (value) out.push({ label: `Prompt ${key.toUpperCase()}`, text: value });
  }
  return out;
}
