/**
 * GET /api/health — liveness, version and a real self-check.
 *
 * The check runs the engine on a fixed input and verifies the shape of the
 * result, so "healthy" means the pipeline actually works, not just that the
 * process is up.
 */

import { architect } from '../src/core/index.mjs';
import { handler, VERSION } from './_lib/http.js';

const PROBE = 'summarise this document for my manager';

export default handler(async () => {
  const started = Date.now();
  const probe = architect(PROBE);
  const checks = {
    pipeline: !probe.error,
    classifies: Boolean(probe.strategy?.categories?.length),
    scoresInRange: probe.score?.total >= 0 && probe.score?.total <= 100,
    traceable: Array.isArray(probe.provenance) ? probe.provenance.length > 0 : false,
  };
  const ok = Object.values(checks).every(Boolean);

  return {
    ok,
    service: 'promptforge',
    version: VERSION,
    engine: 'deterministic-local',
    checks,
    probeMs: Date.now() - started,
    runtime: `node ${process.version}`,
  };
});
