/**
 * Text utilities — tokenisation, normalisation, measurement.
 * Pure functions, no dependencies, safe in Node and browsers.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const SMART_MAP = { '\u2018': "'", '\u2019': "'", '\u201C': '"', '\u201D': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...' };

export function normalizeInput(raw) {
  if (raw == null) return '';
  let s = String(raw);
  s = s.replace(/\r\n?/g, '\n');
  s = s.replace(CONTROL_CHARS, '');
  for (const [k, v] of Object.entries(SMART_MAP)) s = s.split(k).join(v);
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  return s.trim();
}

/** Lowercase, accent-folded, whitespace-collapsed form used for matching. */
export function fold(text) {
  return normalizeInput(text)
    .toLowerCase()
    .replace(/[\u00C0-\u00FF]/g, (c) => c.normalize('NFD').replace(/[\u0300-\u036f]/g, ''))
    .replace(/[^\p{L}\p{N}\s+#./-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function words(text) {
  const f = fold(text);
  return f ? f.split(' ') : [];
}

export function sentences(text) {
  const staged = normalizeInput(text)
    // A question mark or exclamation ends a sentence even when the next word is lowercase.
    .replace(/([?!])\s+(?=\S)/g, '$1\n');
  return staged
    .split(/\n{2,}|(?<=[.!?])\s+(?=[A-Z"'(\d])|^\s*[-*•]\s+/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function lines(text) {
  return normalizeInput(text).split('\n').map((l) => l.trim()).filter(Boolean);
}

export function countWords(text) {
  return words(text).length;
}

/** Rough token estimate (~4 chars/token for English prose). Honest approximation. */
export function estimateTokens(text) {
  if (!text) return 0;
  const chars = String(text).length;
  const w = countWords(text);
  return Math.max(1, Math.round(Math.min(chars / 3.6, w * 1.4 + chars / 12)));
}

export function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

export function titleCase(s) {
  return String(s).replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.slice(1));
}

/** Strip markdown fences and obvious wrapper junk from a pasted prompt. */
export function unwrapPrompt(text) {
  let s = normalizeInput(text);
  const fence = s.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fence) s = fence[1];
  s = s.replace(/^"([\s\S]*)"$/m, (m, inner) => (/["]/.test(inner) ? m : inner));
  return s.trim();
}

/** Split on blank lines / headings into coherent blocks. */
export function blocks(text) {
  return normalizeInput(text)
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}

/** Detect and pull fenced code blocks out of the input. */
export function extractCodeBlocks(text) {
  const out = [];
  const re = /```([a-zA-Z0-9+#.-]*)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push({ lang: (m[1] || '').toLowerCase(), code: m[2].trim() });
  return out;
}

/** Compute a Jaccard-ish overlap ratio of two strings (0..1). */
export function similarity(a, b) {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Deduplicate near-identical lines while preserving order.
 * Splits on newlines only — it must not normalise typography, because callers
 * use this on already-rendered prompt text where em dashes and arrows matter.
 */
export function dedupeLines(text, threshold = 0.86) {
  const seen = [];
  const kept = [];
  const raw = String(text ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  for (const l of raw) {
    if (seen.some((s) => similarity(s, l) >= threshold)) continue;
    seen.push(l);
    kept.push(l);
  }
  return kept.join('\n');
}

/** Strip conversational and prompt-request framing to expose the real task. */
export function stripMetaFrame(text) {
  let s = normalizeInput(text);
  const patterns = [
    /^(hey|hi|hello|yo|please|pls|plz|so|ok|okay|um|well)[,!\s]+/i,
    /^(can|could|would|will)\s+you\s+(please\s+)?/i,
    /^i\s+(really\s+)?(want|need|would like|'d like)\s+(you\s+)?(to\s+)?/i,
    /^(i'm|i am|im)\s+(trying|looking)\s+to\s+/i,
    /^help(?:\s+(?:me|us))?\s+(?:to\s+|with\s+)?/i,
    /^(write|give|make|build|create|generate)\s+me\s+(a|an|the|some)?\s*(prompt|instruction[s]?|system message)\s*(that|which|to|for)?\s*/i,
    /^(i\s+)?(need|want)\s+(a|an|the)?\s*(prompt|instruction[s]?)\s*(that|which|to|for)?\s*/i,
    /^(a|the)\s+prompt\s+(that|which|to)\s+/i,
    /^my\s+(task|goal|objective|requirement)s?\s+is\s*(to)?\s*/i,
    /^(so|therefore|basically)\s+/i,
  ];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 6) {
    changed = false;
    for (const p of patterns) {
      const next = s.replace(p, '');
      if (next !== s) { s = next; changed = true; }
    }
  }
  return s.trim();
}

/** First sentence that carries actual content (≥3 words, not pure pleasantry). */
export function firstMeaningfulSentence(text) {
  for (const s of sentences(text)) {
    if (countWords(s) >= 3) return s;
  }
  return sentences(text)[0] || '';
}

/** Trim a sentence to at most `max` words, preserving meaning. */
export function truncateWords(text, max) {
  const w = normalizeInput(text).split(/\s+/);
  if (w.length <= max) return normalizeInput(text);
  return w.slice(0, max).join(' ').replace(/[,;:]$/, '') + '…';
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function pct(n) {
  return `${Math.round(n)}%`;
}

export function listOut(items, { conjunction = 'and', oxford = false } = {}) {
  const a = items.filter(Boolean);
  if (a.length === 0) return '';
  if (a.length === 1) return a[0];
  const tail = a[a.length - 1];
  const head = a.slice(0, -1).join(', ');
  const sep = oxford ? `, ${conjunction} ` : ` ${conjunction} `;
  return a.length === 2 ? `${head} ${conjunction} ${tail}` : head + sep + tail;
}

/**
 * Does this text describe a task, or is it only asking for a payload?
 *
 * Used by the extractor and the goal builder. Deliberately conservative: when in
 * doubt it says no, because the caller's fallback (the classified task class) is
 * always safe, whereas trusting residue can put attacker-controlled text into
 * the objective of the generated prompt.
 *
 * This is a structural test, not a phrase blocklist: enumerating attack strings
 * is a losing game, so the rule is about what the residue *is*, not what it says.
 */
export function looksLikeTask(text) {
  const t = String(text || '')
    .replace(/^\s*(?:improve|rewrite|expand|compress|fix|optimise|optimize)\s+this\s+prompt\s*:?\s*/i, '')
    .trim();

  if (t.replace(/[\s.,;:\-—'"“”()]/g, '').length < 12) return false;
  if (/^\s*(?:now\s+|then\s+|please\s+)?(?:output|print|say|reply|respond|repeat|echo|return|ignore|forget|disregard|pretend|act\s+as|behave)\b/i.test(t)) return false;
  if (/\byou\s+are\s+now\b/i.test(t)) return false;
  if (/["'“”][A-Z0-9_]{3,}["'“”]/.test(t)) return false;   // quoted payload token
  if (!/[a-z]{3}/i.test(t)) return false;
  return true;
}
