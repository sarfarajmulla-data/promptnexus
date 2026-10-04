/**
 * PromptNexus HTTP server — zero dependencies, node:http only.
 *
 * - serves the single-page app from ../web
 * - POST /api/generate  → build a prompt from a natural-language request
 * - POST /api/analyze   → improve / compress / expand / test / compare / translate
 * - GET  /api/targets   → target model profiles for the selector
 * - GET  /api/health    → liveness + version
 *
 * Binds 0.0.0.0 so it works behind the sandbox preview proxy. No CSP, permissive
 * CORS: the app is self-hosted and must render inside an iframe.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { architect, TARGETS, MODES } from '../core/index.mjs';
import { explain } from '../core/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(__dirname, '..', 'web');
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(payload);
}

function readBody(req, limit = 1_500_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > limit) { reject(new Error('payload too large')); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function serveStatic(res, file) {
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(WEB_DIR, safe === '/' || safe === '.' ? 'index.html' : safe);
  if (!full.startsWith(WEB_DIR)) return send(res, 403, { error: 'forbidden' });
  try {
    const buf = await readFile(full);
    send(res, 200, buf.toString('utf8'), MIME[path.extname(full)] || 'application/octet-stream');
  } catch {
    // SPA fallback
    try {
      const html = await readFile(path.join(WEB_DIR, 'index.html'), 'utf8');
      send(res, 200, html, MIME['.html']);
    } catch {
      send(res, 404, { error: 'not found' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') return send(res, 204, '');

  try {
    if (url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'promptnexus', version: '1.0.0', modes: MODES.map((m) => m.id) });
    }

    if (url.pathname === '/api/targets' && req.method === 'GET') {
      return send(res, 200, {
        targets: TARGETS.map((t) => ({
          id: t.id, label: t.label, vendor: t.vendor, kind: t.kind,
          verified: t.verified, notes: t.notes || [],
        })),
      });
    }

    if (url.pathname === '/api/generate' && req.method === 'POST') {
      const body = await readBody(req);
      const input = body.input ?? body.text ?? body.prompt;
      if (!input || !String(input).trim()) return send(res, 400, { error: 'Provide "input": the situation in your own words.' });
      const result = architect(String(input), {
        targetId: body.targetId || body.target || undefined,
        answers: body.answers || undefined,
        minimal: Boolean(body.minimal),
        advanced: Boolean(body.advanced),
        workflow: Boolean(body.workflow),
        variants: body.variants !== false,
      });
      if (body.explain && !result.error) result.explanation = explain(result);
      return send(res, 200, result);
    }

    if (url.pathname === '/api/analyze' && req.method === 'POST') {
      const body = await readBody(req);
      const input = String(body.input ?? body.prompt ?? '');
      if (!input.trim()) return send(res, 400, { error: 'Provide "input": the prompt to analyse.' });
      const result = architect(input, { targetId: body.targetId, variants: body.variants !== false });
      if (body.explain && !result.error) result.explanation = explain(result, input);
      return send(res, 200, result);
    }

    if (req.method === 'GET') return serveStatic(res, decodeURIComponent(url.pathname.replace(/^\//, '')));
    return send(res, 405, { error: 'method not allowed' });
  } catch (err) {
    return send(res, 500, { error: err.message || 'internal error', hint: 'The engine is deterministic — this is a bug worth reporting with the exact input.' });
  }
});

export function start(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      console.log(`PromptNexus running on http://${host}:${addr.port}`);
      console.log(`Open the preview URL for this port, or http://localhost:${addr.port} locally.`);
      resolve(server);
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  start().catch((e) => { console.error('Failed to start:', e.message); process.exit(1); });
}

export default server;
