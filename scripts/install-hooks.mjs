#!/usr/bin/env node
/**
 * Install git hooks.
 *
 * Uses `core.hooksPath` rather than copying files into .git/hooks, so the hooks
 * are version-controlled and updating them is a normal commit.
 *
 * Runs automatically on `npm install` (there are no dependencies, but the
 * `prepare` script still fires) and on demand via `npm run hooks`.
 */

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hooksDir = path.join(root, '.githooks');

if (!existsSync(path.join(root, '.git'))) {
  console.log('Not a git repository — skipping hook installation.');
  process.exit(0);
}

if (!existsSync(hooksDir)) {
  console.log('No .githooks directory — nothing to install.');
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: root, stdio: 'pipe' });

  // Make every hook executable (Windows ignores this; POSIX does not).
  const { readdirSync } = await import('node:fs');
  for (const file of readdirSync(hooksDir)) {
    if (file.endsWith('.md')) continue;
    chmodSync(path.join(hooksDir, file), 0o755);
  }

  console.log('✓ Git hooks installed (core.hooksPath → .githooks)');
  console.log('  pre-commit: secret scan, syntax check, and a build-output guard');
} catch (err) {
  console.log(`Could not install hooks automatically: ${err.message}`);
  console.log('Run manually:  git config core.hooksPath .githooks');
}
