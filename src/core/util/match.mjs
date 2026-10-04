/**
 * Signal matching — deterministic, explainable scoring of how strongly a piece
 * of text matches a set of weighted signals (keywords, phrases, regexes).
 *
 * Every match is recorded so the UI can show *why* a decision was made.
 */

import { fold, countWords } from './text.mjs';

const REGEX_CACHE = new Map();
function rx(source, flags = '') {
  const key = source + '|' + flags;
  if (!REGEX_CACHE.has(key)) REGEX_CACHE.set(key, new RegExp(source, flags));
  return REGEX_CACHE.get(key);
}

function containsPhrase(foldedText, phrase) {
  const p = fold(phrase);
  if (!p) return false;
  if (p.includes(' ')) return foldedText.includes(p);
  return rx(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}([^\\p{L}\\p{N}]|$)`, 'u').test(foldedText);
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Score one candidate entry against text.
 * @param {string} foldedText
 * @param {{kw?:string[], ph?:string[], re?:string[], weight?:object}} entry
 * @returns {{score:number, hits:string[]}}
 */
export function matchSignals(foldedText, entry) {
  const w = { kw: 1, ph: 2.2, re: 1.6, ...(entry.weight || {}) };
  const hits = [];
  let score = 0;

  for (const k of entry.kw || []) {
    if (containsPhrase(foldedText, k)) {
      score += w.kw;
      hits.push(k);
    }
  }
  for (const p of entry.ph || []) {
    if (foldedText.includes(fold(p))) {
      score += w.ph;
      hits.push(p);
    }
  }
  for (const r of entry.re || []) {
    if (rx(r, 'u').test(foldedText)) {
      score += w.re;
      hits.push(`/${r}/`);
    }
  }
  return { score, hits };
}

/**
 * Rank a list of labelled candidates against text.
 * Applies a length prior so short inputs don't over-trigger.
 */
export function rankSignals(foldedText, candidates, { lengthDamp = true } = {}) {
  const n = countWords(foldedText);
  const damp = lengthDamp ? Math.min(1, 0.45 + n / 40) : 1;
  const ranked = candidates
    .map((c) => {
      const { score, hits } = matchSignals(foldedText, c);
      const raw = score * damp;
      return { ...c, score: raw, hits, rawScore: score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const total = ranked.reduce((s, r) => s + r.score, 0) || 1;
  return ranked.map((r) => ({ ...r, confidence: Math.min(1, r.score / total + (r.score >= 4 ? 0.15 : 0)) }));
}

/** Convenience: best match or null. */
export function bestMatch(foldedText, candidates) {
  const r = rankSignals(foldedText, candidates);
  return r.length ? r[0] : null;
}

/** Detect an explicit format request such as "as JSON", "in a table", "markdown". */
export function findExplicit(matchList, foldedText) {
  const found = [];
  for (const m of matchList) {
    const { hits } = matchSignals(foldedText, { kw: m.kw, ph: m.ph, re: m.re });
    if (hits.length) found.push({ ...m, hits });
  }
  return found;
}

export { containsPhrase, escapeRe };
