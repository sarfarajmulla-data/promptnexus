/**
 * Service abstraction.
 *
 * Every call goes to the serverless API first. If that is unreachable — offline,
 * preview sandbox, cold failure — the same deterministic engine is loaded from
 * /engine/ and runs in the browser instead. Results are identical because it is
 * the same code; only the wording-refinement step is unavailable offline, and
 * the UI says so rather than pretending.
 */

const state = { mode: 'unknown', provider: null, engine: null, reason: '' };

export function runtime() {
  return { ...state, label: state.mode === 'server' ? 'Engine · server' : state.mode === 'local' ? 'No-AI mode' : 'Checking…' };
}

/** Probe the API once at boot; fall back to the local engine if it is unreachable. */
export async function probe() {
  try {
    const res = await fetch('./api/health', { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`health ${res.status}`);
    const data = await res.json();
    if (!data.ok) throw new Error('engine self-check failed');
    state.mode = 'server';
    state.provider = data.provider || null;
    state.reason = '';
    return runtime();
  } catch (err) {
    try {
      const mod = await import('/engine/index.mjs');
      state.engine = mod;
      state.mode = 'local';
      state.reason = 'The API is unreachable, so the engine is running in your browser. Same deterministic code, same result.';
      return runtime();
    } catch {
      state.mode = 'offline';
      state.reason = 'Neither the API nor the local engine could be loaded.';
      return runtime();
    }
  }
}

async function call(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || 'Something went wrong while building your prompt.');
    err.hint = data.hint;
    err.status = res.status;
    err.retryable = Boolean(data.retryable);
    throw err;
  }
  return data;
}

/** Run the engine locally when the API is unavailable. */
function localGenerate(payload) {
  const mod = state.engine;
  if (!mod?.architect) throw Object.assign(new Error('The local engine is not available in this browser.'), { retryable: false });
  const result = mod.architect(payload.input, {
    targetId: payload.targetId || undefined,
    answers: buildAnswers(payload),
    advanced: Boolean(payload.advanced),
    workflow: Boolean(payload.workflow),
  });
  if (result?.error) throw new Error(result.error);
  result.meta = { engine: 'deterministic-local', ms: 0 };
  return result;
}

function buildAnswers(payload) {
  const a = {};
  const o = payload.options || {};
  if (o.audience) a.Audience = o.audience;
  if (o.tone) a.Tone = o.tone;
  if (o.length) a.Length = o.length;
  if (payload.instructions) a['Additional instruction from the user'] = payload.instructions;
  return Object.keys(a).length ? a : undefined;
}

export async function generate(payload) {
  if (state.mode === 'local') return localGenerate(payload);
  try {
    return await call('./api/generate', payload);
  } catch (err) {
    if (state.mode === 'server' && err.status >= 500) {
      await probe();
      if (state.mode === 'local') return localGenerate(payload);
    }
    throw err;
  }
}

export async function analyze(payload) {
  if (state.mode === 'local') return localAnalyze(payload);
  try {
    return await call('./api/analyze', payload);
  } catch (err) {
    if (state.mode === 'server' && err.status >= 500) {
      await probe();
      if (state.mode === 'local') return localAnalyze(payload);
    }
    throw err;
  }
}

/** Local equivalents for every tool action, using the same core functions. */
function localAnalyze(payload) {
  const m = state.engine;
  if (!m) throw Object.assign(new Error('The local engine is not available in this browser.'), { retryable: false });
  const action = payload.action || 'improve';

  if (action === 'compress') {
    const r = m.compressPrompt(payload.prompt);
    return { action, compressed: r, original: { prompt: payload.prompt, stats: m.analyzePrompt(payload.prompt).stats }, meta: { engine: 'deterministic-local' } };
  }
  if (action === 'test') {
    const r = m.testPrompt(payload.prompt);
    return { action, ...r, original: { prompt: payload.prompt }, meta: { engine: 'deterministic-local' } };
  }
  if (action === 'score') {
    return { action, prompt: payload.prompt, ...m.analyzePrompt(payload.prompt), meta: { engine: 'deterministic-local' } };
  }
  if (action === 'compare' || action === 'evaluate') {
    const prompts = payload.prompts?.length
      ? payload.prompts
      : [{ label: 'Prompt A', text: payload.prompt }, ...(payload.b ? [{ label: 'Prompt B', text: payload.b }] : [])];
    const r = m.evaluate(prompts);
    return { action: 'compare', ...r, metricLabels: m.METRIC_LABELS, meta: { engine: 'deterministic-local' } };
  }
  const target = payload.targetId || undefined;
  const r = m.architect(`${action === 'expand' ? 'expand' : 'improve'} this prompt:\n\n${payload.prompt}`, { targetId: target });
  if (r?.error) throw new Error(r.error);
  return { ...r, meta: { engine: 'deterministic-local' } };
}

export async function targets() {
  if (state.mode === 'local' && state.engine) {
    const { TARGETS } = await import('/engine/knowledge/targets.mjs');
    return { targets: TARGETS.map((t) => ({ id: t.id, label: t.label, vendor: t.vendor, kind: t.kind, verified: Boolean(t.verified), notes: t.notes || [] })), taskTypes: [], quality: [], intelligenceModes: [] };
  }
  try {
    const res = await fetch('./api/targets');
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } catch {
    return { targets: [], taskTypes: [], quality: [], intelligenceModes: [] };
  }
}
