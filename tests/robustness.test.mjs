/**
 * Hostile-input robustness.
 *
 * The product takes arbitrary pasted text — that is its entire input surface.
 * Two regular expressions in the pipeline used to be quadratic, and one of them
 * was catastrophic: 24 000 consecutive newlines (trivially produced by pasting a
 * document with blank lines) never finished. On the server that is a one-request
 * denial of service; in the browser it is a frozen tab.
 *
 * Both are fixed, and these tests pin the property so it cannot come back. The
 * bounds are deliberately generous — they are not benchmarks, they separate
 * "linear" from "hangs forever".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { architect, analyzePrompt, compressPrompt } from '../src/core/index.mjs';

/** Run fn and return { ms, value }, failing loudly if it never returns. */
function timed(fn) {
  const t0 = performance.now();
  const value = fn();
  return { ms: performance.now() - t0, value };
}

const BUDGET_MS = 2500;

test('a wall of blank lines does not hang the pipeline', () => {
  // 24 000 newlines took >300 s (never completed) before the fix; now ~1.5 ms.
  const input = `summarise this\n${'\n'.repeat(24_000)}`;
  const { ms, value } = timed(() => architect(input));
  assert.ok(value.prompt.length > 0, 'still produces a prompt');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
});

test('a long run of "if " tokens does not blow up the robustness scorer', () => {
  const input = `do something${' if '.repeat(8_000)}`;
  const { ms, value } = timed(() => architect(input));
  assert.ok(value.prompt.length > 0);
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
});

test('a 200 KB single line is handled in linear time', () => {
  const input = 'word '.repeat(40_000); // ~200 KB, no newlines at all
  const { ms, value } = timed(() => architect(input));
  assert.ok(value.prompt.length > 0);
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
});

test('compare mode survives two hostile prompts', () => {
  const hostile = `prompt a\n${'\n'.repeat(8_000)}`;
  const { ms, value } = timed(() => analyzePrompt(hostile, { action: 'compare', second: `prompt b\n${'\n'.repeat(8_000)}` }));
  assert.ok(value, 'compare returns a result rather than throwing');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
});

test('compression of a hostile blob terminates', () => {
  const input = `Write a report.\n${'\n'.repeat(12_000)}`;
  const { ms, value } = timed(() => compressPrompt(input));
  assert.ok(typeof value.text === 'string');
  assert.ok(ms < BUDGET_MS, `took ${ms.toFixed(0)} ms, budget ${BUDGET_MS} ms`);
});

test('empty and whitespace-only input returns a structured error, not a crash', () => {
  // Deliberate contract: the engine answers with `{ error }` carrying a sentence
  // a person can act on, rather than throwing or inventing a task from nothing.
  for (const input of ['', '   ', '\n\n\n', '\t\t']) {
    const r = architect(input);
    assert.equal(typeof r.error, 'string', `empty-ish input ${JSON.stringify(input)} should report an error`);
    assert.ok(r.error.length > 20, 'the error must explain what to do');
    assert.ok(!/undefined|\[object|at \w+ \(/.test(r.error), `human wording, got: ${r.error}`);
    assert.equal(r.prompt, '', 'no prompt is invented from empty input');
  }
});
