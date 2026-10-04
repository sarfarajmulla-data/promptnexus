#!/usr/bin/env node
/**
 * Build step: copy the deterministic engine into `public/engine/` so the
 * browser can run it directly.
 *
 * Why this exists: the engine has no Node-only imports, so the exact same code
 * that powers the API routes can also run client-side. That gives the app a real
 * degradation path — if the serverless function is unreachable (offline, cold
 * failure, preview sandbox), the UI loads the engine from disk and computes the
 * same deterministic result locally instead of showing an error.
 *
 * No bundler, no dependencies: a recursive copy that preserves the relative
 * import structure.
 */

import { cp, rm, mkdir, readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src', 'core');
const OUT = path.join(root, 'public', 'engine');

/** Fail loudly rather than shipping a browser bundle that cannot run. */
async function assertBrowserSafe(dir) {
  const offenders = [];
  async function walk(d) {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.mjs')) {
        const text = await readFile(full, 'utf8');
        for (const m of text.matchAll(/from\s+'([^']+)'/g)) {
          if (m[1].startsWith('node:')) offenders.push(`${path.relative(root, full)} imports ${m[1]}`);
        }
        for (const m of text.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
          offenders.push(`${path.relative(root, full)} uses require(${m[2]})`);
        }
      }
    }
  }
  await walk(dir);
  if (offenders.length) {
    console.error('Engine is not browser-safe:\n' + offenders.map((o) => '  - ' + o).join('\n'));
    process.exit(1);
  }
}

async function countFiles(dir) {
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) n += await countFiles(path.join(dir, entry.name));
    else n += 1;
  }
  return n;
}

async function main() {
  await stat(SRC).catch(() => {
    console.error(`Missing engine source at ${SRC}`);
    process.exit(1);
  });

  await assertBrowserSafe(SRC);

  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await cp(SRC, OUT, { recursive: true });

  const files = await countFiles(OUT);
  await writeFile(
    path.join(OUT, 'BUILD.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), files, source: 'src/core' }, null, 2) + '\n',
  );

  console.log(`engine copied → public/engine  (${files} modules, browser-safe)`);
}

main().catch((err) => {
  console.error('Build failed:', err.message);
  process.exit(1);
});
