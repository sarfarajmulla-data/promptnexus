/**
 * State + local persistence. Small on purpose: one mutable object, one
 * subscribe list, no framework. Every write notifies once.
 */

const KEY = 'promptnexus.v1';

const defaults = {
  onboarded: false,
  profile: { use: '', experience: 'balanced', favourite: '' },
  settings: {
    theme: 'dark', motion: 'auto', field: true, compact: false,
    provider: 'auto', defaultTarget: '', defaultQuality: 'balanced',
  },
  view: 'landing',
  draft: { input: '', targetId: '', taskType: '', quality: 'balanced', mode: 'auto', advanced: { audience: '', tone: '', length: '', instructions: '' } },
  lastResult: null,
  library: [],
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(defaults);
    const saved = JSON.parse(raw);
    return {
      ...structuredClone(defaults),
      ...saved,
      settings: { ...defaults.settings, ...(saved.settings || {}) },
      draft: { ...defaults.draft, ...(saved.draft || {}), advanced: { ...defaults.draft.advanced, ...(saved.draft?.advanced || {}) } },
    };
  } catch {
    return structuredClone(defaults);
  }
}

export const state = load();
const listeners = new Set();

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function update(patch, { persist = true } = {}) {
  Object.assign(state, typeof patch === 'function' ? patch(state) : patch);
  if (persist) save();
  for (const fn of listeners) fn(state);
}

export function updateSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  save();
  for (const fn of listeners) fn(state);
}

export function updateDraft(patch) {
  state.draft = { ...state.draft, ...patch, advanced: { ...state.draft.advanced, ...(patch.advanced || {}) } };
  save();
  for (const fn of listeners) fn(state);
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota or private mode: run in memory */ }
}

/* ── library ─────────────────────────────────────────────────────────── */

export function savePrompt(entry) {
  const item = {
    id: entry.id || `p_${Date.now().toString(36)}`,
    name: entry.name || deriveName(entry.prompt),
    prompt: entry.prompt,
    request: entry.request || '',
    category: entry.category || 'Other',
    targetId: entry.targetId || 'generic',
    targetLabel: entry.targetLabel || 'Generic AI',
    score: entry.score ?? null,
    tags: entry.tags || [],
    favourite: Boolean(entry.favourite),
    savedAt: entry.savedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const existing = state.library.findIndex((p) => p.id === item.id);
  if (existing >= 0) state.library[existing] = { ...state.library[existing], ...item };
  else state.library.unshift(item);
  save();
  for (const fn of listeners) fn(state);
  return item;
}

export function deletePrompt(id) {
  state.library = state.library.filter((p) => p.id !== id);
  save();
  for (const fn of listeners) fn(state);
}

export function toggleFavourite(id) {
  const p = state.library.find((x) => x.id === id);
  if (p) { p.favourite = !p.favourite; save(); for (const fn of listeners) fn(state); }
}

export function wipe() {
  localStorage.removeItem(KEY);
  location.reload();
}

function deriveName(prompt) {
  const first = String(prompt || '').split('\n').find((l) => l.trim() && !/^#/.test(l.trim())) || 'Untitled prompt';
  return first.replace(/^#+\s*/, '').slice(0, 60);
}

/* ── theme ───────────────────────────────────────────────────────────── */

export function applyTheme() {
  const s = state.settings;
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
  const theme = s.theme === 'system' ? (prefersLight ? 'light' : 'dark') : s.theme;
  document.documentElement.dataset.theme = theme;
  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = s.motion === 'reduced' || (s.motion === 'auto' && prefersReduced);
  document.documentElement.dataset.motion = reduced ? 'reduced' : 'full';
  document.documentElement.dataset.density = s.compact ? 'compact' : 'comfortable';
  return { theme, reduced };
}
