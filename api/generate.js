/**
 * POST /api/generate
 *
 * Builds an optimised prompt from a natural-language description of a situation.
 * Thin adapter over the deterministic engine — no model calls, no network.
 */

import { architect, explain } from '../src/core/index.mjs';
import { handler, readBody, requirePost, requireInput, httpError, VERSION } from './_lib/http.js';

const TARGET_IDS = new Set([
  'generic', 'chatgpt', 'claude', 'gemini', 'ai-studio', 'lmarena', 'grok', 'perplexity',
  'copilot', 'deepseek', 'qwen', 'mistral', 'oss-llm', 'claude-code', 'website-builder',
  'midjourney', 'gpt-image', 'stable-diffusion', 'ideogram', 'video-model', 'api-system',
  'agent-framework',
]);

export default handler(async (req, res, meta) => {
  requirePost(req);
  const body = readBody(req);
  const input = requireInput(body);

  const targetId = typeof body.targetId === 'string' && body.targetId
    ? (TARGET_IDS.has(body.targetId) ? body.targetId : (() => { throw httpError(400, `Unknown target model "${body.targetId}".`, 'Omit targetId to let the engine auto-detect.'); })())
    : undefined;

  const answers = body.answers && typeof body.answers === 'object' ? sanitiseAnswers(body.answers) : undefined;
  const instructions = typeof body.instructions === 'string' ? body.instructions.trim().slice(0, 2000) : '';

  const result = architect(input, {
    targetId,
    answers: instructions ? { ...(answers || {}), 'Additional instruction from the user': instructions } : answers,
    minimal: Boolean(body.minimal),
    advanced: Boolean(body.advanced),
    workflow: Boolean(body.workflow),
    variants: body.variants !== false,
  });

  if (result.error) throw httpError(422, result.error);

  if (body.explain) result.explanation = explain(result);
  result.meta = { ms: Date.now() - meta.started, version: VERSION, engine: 'deterministic-local' };
  return result;
});

/** Keep answers to short, plain strings — anything else is ignored rather than trusted. */
function sanitiseAnswers(answers) {
  const out = {};
  for (const [k, v] of Object.entries(answers)) {
    if (typeof v !== 'string' && typeof v !== 'number') continue;
    const key = String(k).slice(0, 60);
    const value = String(v).trim().slice(0, 500);
    if (key && value) out[key] = value;
  }
  return out;
}
