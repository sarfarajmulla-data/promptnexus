#!/usr/bin/env node
/**
 * Local development + preview server.
 *
 * Serves `public/` as the web root and routes `/api/*` through the same
 * serverless handler modules Vercel deploys, so local behaviour and production
 * behaviour come from one implementation. No dependency, no framework.
 */

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// server.mjs lives in src/server/, so the repository root is two levels up.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC = path.join(root, 'public');
const PORT = Number(process.env.PORT || 4317);
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/** Adapter: give a serverless-style handler a Node http req/res. */
async function invokeApi(route, req, res) {
  let mod;
  try {
    mod = await import(path.join(root, 'api', `${route}.js`));
  } catch {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `No API route for /api/${route}` }));
    return;
  }
  const handler = mod.default;
  if (typeof handler !== 'function') {
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Route /api/${route} has no default export` }));
    return;
  }

  // Buffer the body so handlers can read it exactly as they do on Vercel.
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw) {
    req.body = raw;
    try { req.body = JSON.parse(raw); } catch { /* leave as string; helper reports it */ }
  }
  await handler(req, res);
}

async function serveStatic(pathname, req, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // SPA fallback: extensionless paths render the shell.
  let file = path.join(PUBLIC, rel);
  if (!path.resolve(file).startsWith(PUBLIC)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
  } catch {
    if (path.extname(rel)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    file = path.join(PUBLIC, 'index.html');
  }

  try {
    const body = await readFile(file);
    const ext = path.extname(file);
    const immutable = /\.(mjs|css|js|woff2|png|jpg|webp|svg)$/.test(file) && /\/engine\/|\/js\/|\/assets\//.test(file);
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
      'x-content-type-options': 'nosniff',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
    }).end();
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    await invokeApi(url.pathname.replace(/^\/api\//, '').replace(/\/$/, ''), req, res);
    return;
  }

  await serveStatic(url.pathname, req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`PromptNexus running on http://${HOST}:${PORT}`);
  console.log(`  app      → http://localhost:${PORT}/`);
  console.log(`  api      → http://localhost:${PORT}/api/health`);
  console.log(`  engine   → http://localhost:${PORT}/engine/index.mjs`);
});
