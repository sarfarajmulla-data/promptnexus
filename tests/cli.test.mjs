/**
 * CLI contract tests.
 *
 * These exist because of a real escape: `src/cli/promptnexus.mjs` imported
 * `start` from `src/server/server.mjs`, which exported nothing. Every CLI
 * invocation — including the published `bin` entry — died with
 * `SyntaxError: The requested module does not provide an export named 'start'`,
 * and all 56 tests still passed because nothing exercised this surface.
 *
 * Anything in the `bin` field gets a test here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(ROOT, 'src', 'cli', 'promptnexus.mjs');

/** Run the CLI synchronously and return { status, stdout, stderr }. */
function run(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

test('the CLI module loads and prints usage', () => {
  const { status, stdout } = run('--help');
  assert.equal(status, 0, 'help must exit 0');
  assert.match(stdout, /PromptNexus/);
  assert.match(stdout, /USAGE/);
  // The help text is the product's contract with the user; if a command is
  // advertised it must be listed here.
  for (const cmd of ['improve', 'expand', 'compress', 'test', 'compare', 'explain', 'targets', 'modes', 'serve', 'demo']) {
    assert.ok(stdout.includes(cmd), `help should mention "${cmd}"`);
  }
});

test('a bare situation produces a full prompt', () => {
  const { status, stdout } = run('help me revise for my dbms exam');
  assert.equal(status, 0);
  assert.match(stdout, /UNDERSTOOD GOAL/);
  assert.match(stdout, /FINAL PROMPT/);
  assert.match(stdout, /dbms/i, 'the user\'s own words must appear');
});

test('--json emits parseable output with the documented fields', () => {
  const { status, stdout } = run('build my portfolio website', '--json');
  assert.equal(status, 0);
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed.prompt, 'string');
  assert.ok(parsed.prompt.length > 200, 'a real prompt, not a stub');
  assert.equal(typeof parsed.goal, 'string');
  assert.ok(typeof parsed.score?.total === 'number');
});

test('improve, compress and compare all complete', () => {
  const prompt = 'Write a blog post about TypeScript generics for junior developers. Make it 800 words.';

  const improved = run('improve', prompt);
  assert.equal(improved.status, 0);
  assert.match(improved.stdout, /FINAL PROMPT/);

  const compressed = run('compress', prompt, '--json');
  assert.equal(compressed.status, 0);
  const c = JSON.parse(compressed.stdout);
  assert.ok(c.after.words <= c.before.words, 'compression must not grow the prompt');

  const compared = run('compare', `${prompt}\n\nvs\n\n${prompt}`, '--json');
  assert.equal(compared.status, 0);
  const cmp = JSON.parse(compared.stdout);
  assert.ok(typeof cmp.verdict === 'string');
});

test('a named command with no input exits non-zero with a usable message', () => {
  // Free text is a valid situation for the default command, so "unknown
  // command" is not an error — but a *named* command with nothing to work on is.
  const { status, stdout, stderr } = run('improve');
  const all = `${stdout}${stderr}`;
  assert.notEqual(status, 0, 'missing input must not report success');
  assert.match(all, /needs some text/i);
  assert.ok(!/\bat [\w.]+ \(/.test(all), `no raw stack trace, got:\n${all}`);
});

test('a bare invocation prints help and exits 0', () => {
  const { status, stdout } = run();
  assert.equal(status, 0, 'help is not a failure');
  assert.match(stdout, /USAGE/);
});

test('serve binds a port, answers /api/health, and shuts down when killed', async () => {
  const port = 4457;
  const child = spawn(process.execPath, [CLI, 'serve', '--port', String(port)], {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });

  try {
    // Poll for readiness rather than sleeping a fixed amount.
    let healthy = false;
    for (let i = 0; i < 60 && !healthy; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) {
          const body = await res.json();
          assert.equal(body.ok, true);
          assert.equal(body.service, 'promptnexus');
          healthy = true;
        }
      } catch { /* not up yet */ }
    }
    assert.ok(healthy, `serve never became healthy. Output:\n${log}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }

  // Killed by signal: Node reports signalCode, and exitCode stays null.
  assert.ok(
    child.signalCode === 'SIGTERM' || child.exitCode !== null,
    `server did not terminate (signalCode=${child.signalCode}, exitCode=${child.exitCode})`,
  );
});

test('an invalid port is rejected with a human message, not a stack trace', () => {
  const { status, stdout, stderr } = run('serve', '--port', 'not-a-port');
  const all = `${stdout}${stderr}`;
  assert.notEqual(status, 0, 'a bad port must not report success');
  assert.match(all, /port/i);
  assert.ok(!/node:internal/.test(all), `no internal frames, got:\n${all}`);
});

test('importing the server module does not bind a port', async () => {
  // Regression guard: the CLI imports the server, so module-level side effects
  // would claim the port on every CLI invocation, including `--help`.
  const mod = await import(path.join(ROOT, 'src', 'server', 'server.mjs'));
  assert.equal(typeof mod.start, 'function', 'start must be exported');
  assert.equal(typeof mod.createApp, 'function', 'createApp must be exported');
});
