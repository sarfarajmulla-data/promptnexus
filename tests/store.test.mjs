/**
 * Persistence contract for the browser store.
 *
 * The project was renamed from one word to another after the beta shipped, which
 * moved its localStorage key. Anyone who had used the beta would silently lose
 * their library and settings unless the old key is carried across — so this is
 * tested rather than assumed.
 *
 * `store.js` reads global `localStorage` and `document` at import time, so each
 * case gets fresh stubs and a cache-busted module URL (Node caches ESM by URL).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const STORE = pathToFileURL(path.resolve('public', 'js', 'store.js')).href;

/** Install browser-ish globals and import a fresh copy of the store. */
async function loadStore(seed = {}) {
  const data = new Map(Object.entries(seed));
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

  const mod = await import(`${STORE}?case=${Math.random().toString(36).slice(2)}`);
  return { state: mod.state, data };
}

test('a fresh browser gets defaults and the new key', async () => {
  const { state, data } = await loadStore();
  assert.equal(state.onboarded, false);
  assert.deepEqual(state.library, []);
  assert.equal(state.settings.theme, 'dark');
  assert.equal(data.size, 0, 'loading alone must not write anything');
});

test('state saved under the old key is carried over and the old key removed', async () => {
  const legacy = JSON.stringify({
    onboarded: true,
    library: [{ id: 'p1', text: 'a prompt saved before the rename' }],
    settings: { theme: 'light', provider: 'openai' },
  });
  const { state, data } = await loadStore({ 'promptnexus.v1': legacy });

  assert.equal(state.onboarded, true, 'onboarding flag survives');
  assert.equal(state.library.length, 1, 'library survives');
  assert.equal(state.library[0].text, 'a prompt saved before the rename');
  assert.equal(state.settings.theme, 'light', 'settings survive');
  assert.equal(state.settings.provider, 'openai');

  assert.ok(data.has('promptforge.v1'), 'written under the new key');
  assert.ok(!data.has('promptnexus.v1'), 'old key cleaned up');
});

test('a corrupt store falls back to defaults instead of throwing', async () => {
  const { state } = await loadStore({ 'promptforge.v1': '{not json at all' });
  assert.equal(state.onboarded, false);
  assert.deepEqual(state.library, []);
});

test('partial saved state is merged over defaults, not replaced', async () => {
  const { state } = await loadStore({
    'promptforge.v1': JSON.stringify({ settings: { theme: 'light' } }),
  });
  assert.equal(state.settings.theme, 'light', 'saved value wins');
  assert.equal(state.settings.provider, 'auto', 'unsaved value keeps its default');
  assert.deepEqual(state.draft.advanced, { audience: '', tone: '', length: '', instructions: '' });
});

test('hostile or unavailable storage does not break startup', async () => {
  globalThis.localStorage = {
    getItem() { throw new Error('SecurityError: storage disabled'); },
    setItem() { throw new Error('SecurityError'); },
    removeItem() { throw new Error('SecurityError'); },
  };
  globalThis.document = { documentElement: { dataset: {} } };
  const mod = await import(`${STORE}?case=${Math.random().toString(36).slice(2)}`);
  assert.equal(mod.state.onboarded, false, 'still boots with defaults');
});
