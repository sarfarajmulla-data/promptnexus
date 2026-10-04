/**
 * Re-export of the shared evaluation module.
 *
 * The metric mapping lives in `src/core/pipeline/evaluate.mjs` so the API and
 * the browser fallback compute identical numbers from identical code.
 */

export { evaluate, metricsFor, METRIC_LABELS } from '../../src/core/pipeline/evaluate.mjs';
