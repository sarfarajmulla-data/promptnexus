# Monitoring

What is observed, what is deliberately not, and what would be added before this
carries real traffic. Kept honest: everything marked "not set up" is genuinely not
set up.

---

## What is monitored today

| Signal | How | Where to look |
|---|---|---|
| **Liveness + pipeline health** | `GET /api/health` runs the engine on a fixed input and asserts four properties | `curl https://<deployment>/api/health` |
| Build success | CI gates: 71 tests, zero-dependency assertion, engine purity, determinism, API smoke test | GitHub → Actions |
| Deploy status | Vercel deployment list | Vercel dashboard |
| Runtime errors | Vercel function logs (shaped errors, never stack traces) | Vercel → Deployments → Functions |
| Dependency risk | Dependabot watches the npm ecosystem and the workflow actions | GitHub → Security |
| Static analysis | CodeQL weekly | GitHub → Security |

### Why `/api/health` is a real check

A liveness endpoint that returns `{"ok":true}` unconditionally is decoration. This
one runs the engine end to end and asserts:

```json
{
  "ok": true,
  "checks": {
    "pipeline": true,        // the engine produced a result
    "classifies": true,      // it assigned a category
    "scoresInRange": true,   // the score is 0–100
    "traceable": true        // provenance was emitted
  },
  "probeMs": 190
}
```

If a refactor breaks classification or provenance, health goes red **before** a
user notices — which is the only reason to have the endpoint.

## What is deliberately not set up

Listed explicitly so the gaps are known rather than assumed away.

| Not set up | Why | What would change the answer |
|---|---|---|
| Error tracker (Sentry et al.) | Errors are already shaped, rare, and reported with enough context by the client; there is no user-facing crash loop to triage | Real traffic, or provider routing introducing external failure modes |
| Structured JSON logging | There is nothing to correlate: no accounts, no session, no multi-step server work, and no user data to log safely | Provider routing, which would need request IDs and provider latency |
| Uptime pinger | `/api/health` exists and is the right target, but no external pinger is configured | The first real deployment expecting traffic |
| Performance metrics (p95 latency) | The engine is pure and completes in under 150 ms; Vercel reports function duration natively | Provider routing, which adds a real external round-trip |
| Business metrics | There is no business layer — no accounts, no plans, no payments. There is nothing to count | Any monetisation decision |
| Alerting and on-call | No traffic, no SLA, no one to page at 3 a.m. | First paying user |
| Status page | Meaningless without users | Public launch |

**The honest summary:** this application is instrumented for *correctness*
(CI gates and a real self-check) and not for *operations*, because there is no
operation to run — no state, no jobs, no accounts. Adding a metrics stack now would
be dashboard theatre.

## What would be added before real traffic

In priority order, and only when each is justified:

1. **An uptime pinger** on `/api/health` with an alert to a real inbox. Cheapest
   real improvement; the endpoint already exists.
2. **Vercel log drains** to a searchable sink, with a retention window, the day a
   provider is configured.
3. **A request ID** generated per function invocation, returned in a response
   header, and included in every log line for that request.
4. **Provider budget alerts** — per-day call caps and a global spending ceiling, so
   a runaway loop cannot become an invoice.
5. **Alert rules**, each with a runbook, for: health red for 5 minutes, function
   error rate above 2% over 15 minutes, provider daily cap at 80%.

## Rules for anything added here

1. **Never log request text.** Users paste documents; logging them would create a
   data-protection problem the product currently does not have.
2. **Never log a key or token.** Redaction is automatic for `password`, `token`,
   `secret`, `authorization`, and anything matching the configured key patterns.
3. **Alert only on things a human must act on.** An alert nobody actions is a
   broken pager, and it teaches people to ignore the real one.
4. **Every alert links to a runbook.** See [`runbooks/`](./runbooks/).
5. **Health checks must exercise real behaviour.** A check that cannot fail is
   worse than no check, because it produces false confidence.

## Verifying observability

- [ ] `curl -s $BASE/api/health` returns `"ok": true` with all four checks true
- [ ] Breaking a classifier locally makes health go red (verify once, deliberately)
- [ ] Billing alerts are set on the Vercel account
- [ ] No user text appears in function logs after a session of use
