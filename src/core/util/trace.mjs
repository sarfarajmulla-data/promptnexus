/**
 * Trace — the audit log of the pipeline.
 *
 * The engine never exposes private chain-of-thought; instead it records
 * *decisions*: what it detected, what it chose, on what evidence, and why.
 * This object is the single source of truth for the UI's reasoning panels.
 */

export function createTrace() {
  const steps = [];
  const t0 = now();

  return {
    steps,
    /** Record a pipeline stage result. */
    stage(id, label, { summary, decisions = [], evidence = [], data } = {}) {
      steps.push({
        id,
        label,
        summary: summary || '',
        decisions: decisions.filter(Boolean),
        evidence: evidence.filter(Boolean),
        data,
        ms: 0,
        at: now() - t0,
      });
      return this;
    },
    /** Append a decision to the most recent stage. */
    decide(text, detail) {
      const s = steps[steps.length - 1];
      if (!s) return this;
      s.decisions.push(detail ? { text, detail } : { text });
      return this;
    },
    /** Attach timestamped cost to the last stage. */
    closeStage(stageStart) {
      const s = steps[steps.length - 1];
      if (s) s.ms = Math.max(0, now() - stageStart);
      return this;
    },
    start() {
      return now();
    },
    /** Human-readable "what the engine concluded" digest, grouped by stage. */
    digest() {
      return steps.map((s) => `[${s.label}] ${s.summary}`).join('\n');
    },
    /** Concise reasoning summary for the output header (never private CoT). */
    rationale(limit = 3) {
      return steps
        .filter((s) => s.summary)
        .slice(0, limit)
        .map((s) => s.summary);
    },
  };
}

function now() {
  if (typeof performance !== 'undefined' && performance.now) return performance.now();
  return Date.now();
}

/** Round a number to n decimals without floating noise. */
export function round(n, d = 2) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}
