#!/usr/bin/env node
/**
 * Local development + preview server.
 *
 * Serves `public/` as the web root and routes `/api/*` through the same
 * serverless handler modules Vercel deploys, so local behaviour and production
 * behaviour come from one implementation. No dependency, no framework.
 */

import http from 'node:http';
import { readFile } from 'node:fs/promises';
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

/** Read a file, or resolve the path to read instead. Returns null when there is nothing to serve. */
async function resolveBody(rel) {
  const target = path.join(PUBLIC, rel);
  const resolved = path.resolve(target);
  // Guard against traversal, including the sibling-directory case that a plain
  // `startsWith(PUBLIC)` would let through (e.g. a directory named `public-old`).
  if (resolved !== PUBLIC && !resolved.startsWith(PUBLIC + path.sep)) return null;

  try {
    return { file: target, body: await readFile(target) };
  } catch (err) {
    // A directory request (or `/`) serves its index.html.
    if (err.code === 'EISDIR') {
      const index = path.join(target, 'index.html');
      try { return { file: index, body: await readFile(index) }; } catch { return null; }
    }
    // SPA fallback: an extensionless path is a route, so render the shell.
    if (!path.extname(rel)) {
      const shell = path.join(PUBLIC, 'index.html');
      try { return { file: shell, body: await readFile(shell) }; } catch { return null; }
    }
    return null;
  }
}

async function serveStatic(pathname, req, res) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  // One read, one decision: no stat-then-read window between the check and the use.
  const found = await resolveBody(rel);
  if (!found) {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return;
  }

  const ext = path.extname(found.file);
  const immutable = /\.(mjs|css|js|woff2|png|jpg|webp|svg)$/.test(found.file)
    && /\/engine\/|\/js\/|\/assets\//.test(found.file);

  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=3600' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  res.end(found.body);
}

/**
 * Build the HTTP server without binding a port.
 *
 * Exported so callers (the CLI's `serve` command, tests) can own the listen
 * step, and so importing this module never has the side effect of claiming a
 * port.
 */
export function createApp() {
  return http.createServer(async (req, res) => {
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
}

/**
 * Start listening.
 *
 * @param {number|string} port
 * @param {string} host
 * @returns {Promise<import('node:http').Server>} resolves once the port is bound
 */
export function start(port = PORT, host = HOST) {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    return Promise.reject(new RangeError(`Port must be an integer between 0 and 65535 — received ${JSON.stringify(port)}.`));
  }

  const server = createApp();
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`Port ${parsed} is already in use. Stop the process using it, or pass a different --port.`));
        return;
      }
      if (err.code === 'EACCES') {
        reject(new Error(`Not allowed to bind port ${parsed}. Ports below 1024 usually need elevated privileges — try --port 4317.`));
        return;
      }
      reject(err);
    });
    server.listen(parsed, host, () => {
      const actual = server.address().port;
      console.log(`PromptForge running on http://${host}:${actual}`);
      console.log(`  app      → http://localhost:${actual}/`);
      console.log(`  api      → http://localhost:${actual}/api/health`);
      console.log(`  engine   → http://localhost:${actual}/engine/index.mjs`);
      resolve(server);
    });
  });
}

// Auto-start only when run directly (`node src/server/server.mjs`), never on import.
const invokedDirectly = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  start().catch((err) => {
    console.error(`Could not start the server: ${err.message}`);
    process.exitCode = 1;
  });
}
