/**
 * Shared HTTP helpers for the serverless API.
 *
 * Files under `api/_lib/` are not deployed as functions (Vercel ignores
 * underscore-prefixed paths), so this is the right place for shared code.
 */

export const VERSION = '1.0.0';

export function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

/** Body may already be parsed by the platform, or arrive as a raw string. */
export function readBody(req, limit = 1_000_000) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (req.body.length > limit) throw httpError(413, 'Request body is too large. Trim the input and try again.');
    try { return JSON.parse(req.body); } catch { throw httpError(400, 'The request body must be valid JSON.'); }
  }
  return {};
}

export function httpError(status, message, hint) {
  const err = new Error(message);
  err.status = status;
  err.hint = hint;
  return err;
}

export function options(req, res) {
  if (req.method === 'OPTIONS') { send(res, 204, ''); return true; }
  return false;
}

export function requirePost(req) {
  if (req.method !== 'POST') throw httpError(405, 'Use POST for this endpoint.');
}

export function requireInput(body, field = 'input') {
  const value = body?.[field];
  if (!value || !String(value).trim()) {
    throw httpError(400, 'Nothing to work with yet.', `Send { "${field}": "…" } describing the situation or prompt.`);
  }
  return String(value);
}

/** Wrap a handler with consistent error shaping and timing. */
export function handler(fn) {
  return async function wrapped(req, res) {
    if (options(req, res)) return;
    const started = Date.now();
    try {
      const body = await fn(req, res, { started });
      if (body !== undefined && !res.writableEnded) send(res, 200, body);
    } catch (err) {
      const status = err.status || 500;
      // Never leak stack traces or internals to the client.
      send(res, status, {
        error: status === 500 ? 'Something went wrong while building your prompt.' : err.message,
        hint: err.hint || (status === 500
          ? 'This engine is deterministic, so a failure here is a bug worth reporting with the exact input.'
          : undefined),
        retryable: status >= 500,
        meta: { ms: Date.now() - started, version: VERSION },
      });
    }
  };
}
