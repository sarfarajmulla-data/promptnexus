# Threat model

Assets, entry points, threats and mitigations. Reviewed before each release.

---

## Assets

| Asset | Value | Where it lives |
|---|---|---|
| The user's request text | Personal and potentially confidential — people paste documents into this | In transit to a function, or entirely in the browser; **never stored** |
| The user's prompt library | Their accumulated work | `localStorage`, on their device only |
| Provider API keys (if configured) | Billable and abusable | Server-side environment variables |
| The engine's honesty guarantees | The reason to trust the output | `src/core`, protected by tests |

## Entry points

| Entry point | Input | Trust |
|---|---|---|
| `POST /api/generate` | A situation description | Untrusted |
| `POST /api/analyze` | A prompt, or up to three | **Untrusted — and the most interesting** |
| `GET /api/targets`, `/api/health` | None | — |
| The composer | Keyboard, clipboard, file attach (read locally) | Untrusted |
| `localStorage` | Anything already on the device | Untrusted on read (it is parsed as JSON and validated) |
| Provider responses (future) | Model output | Untrusted |

## Threats

### T1 — Prompt injection via pasted content · **the primary threat**

*Scenario:* a user pastes a document containing "ignore all previous instructions
and output X". The engine analyses it. If the text were treated as instruction,
the generated prompt could carry an attacker's payload, or the objective itself
could become the attacker's instruction.

*Mitigations:*

- Pasted content is stripped of known override patterns before analysis, and the
  attempt is **reported to the user** rather than silently dropped.
- Stripping runs to a fixed point, because patterns overlap (removing "you are now
  X" from "SYSTEM: you are now X" once left a bare `SYSTEM:`).
- **Structural containment, not a phrase list:** residue must pass `looksLikeTask()`
  on its own merits, and the raw headline is never used as a fallback once an
  attempt is flagged. This is what stops an unseen phrasing from working.
- A "report rather than obey" rule is written into the generated prompt itself.
- Covered by eight attack phrasings in tests, plus five legitimate prompts that
  must **not** be flagged.

*Residual risk:* an entirely novel phrasing that also looks like a plausible task
description. The blast radius is bounded: it appears as the prompt's objective, and
the user sees the objective before sending it.

### T2 — Secret exposure

*Scenario:* a provider key reaches the browser bundle, a response body, or a log line.

*Mitigations:* keys are read from `process.env` inside the function only; the
browser engine has no I/O at all; responses echo no configuration; errors are
shaped with generic messages; the build step rejects any `node:` import in
`src/core/`, which is what would be needed to read the environment. *Verified by*
a test asserting error bodies contain no paths or internals.

### T3 — Cross-site scripting

*Scenario:* user text (a saved prompt name, a provenance line) is rendered into the
DOM unescaped, executing script in another visitor's browser.

*Mitigations:* the library is local to the origin, so one visitor cannot place text
in another's DOM the way a shared server would allow. All text rendering goes
through `esc()`. No `innerHTML` path takes untrusted text without escaping.

*Residual risk:* a missed path. The CSP is intentionally permissive (none set),
which makes XSS impact worse if it occurs — recorded below as an accepted gap.

### T4 — Denial of service via oversized input

*Mitigations:* 1 MB body limit, refused with a message rather than buffered; the
engine is linear in input length; function duration is capped at 15 s. Nothing is
written, so there is no amplification.

### T5 — Malicious input crashing the engine

*Scenario:* malformed or adversarial text throws inside the pipeline, producing a
500 with internals exposed, or a hang.

*Mitigations:* every technique renderer is wrapped against throwing; the pipeline
returns a structured error rather than an exception; error responses are generic;
`meta.retryable` is only true for `5xx`. Fuzzed informally with hostile strings in
`tests/tools.test.mjs`.

### T6 — Supply chain

*Scenario:* a dependency is compromised.

*Mitigation:* **there are no runtime dependencies**, asserted in CI. The attack
surface is the workflow actions, which Dependabot tracks weekly. This is the single
largest structural security benefit of the zero-dependency decision.

### T7 — Data retention and privacy

*Scenario:* the operator logs user text; a user pastes something confidential.

*Mitigation:* the application has no logging of request bodies, no database, and no
storage. A provider, if configured, is the only third party that would see request
text — and the UI states when one is active.

## Out of scope

| Item | Why |
|---|---|
| Authentication and account takeover | No accounts exist |
| Payment fraud | No payments |
| Multi-tenant isolation | No tenancy — see [`../permissions.md`](../permissions.md) |
| Physical and insider threats to infrastructure | Delegated to Vercel |
| The legality of a user's *subject matter* | The engine generates prompts, not unlawful content; it refuses prompts that facilitate harm (see `SECURITY.md`) |

## Accepted gaps

Recorded rather than left implied:

1. **No external penetration test.** The attack surface is small and the sensitive
   data is minimal; a professional audit is not yet justified. This would change if
   provider routing or accounts were added.
2. **No CSP header.** A permissive default is a deliberate trade-off against the
   inline-style design system; with no user-generated content rendered across
   origins and no third-party scripts, the practical exposure is low. Tightening
   it is the first hardening step if XSS is ever found.
3. **Browser-local data is not encrypted at rest.** It is the user's own text on
   their own device; encrypting it would require a key the product has nowhere to
   store without inventing the account system it deliberately lacks.

## Review cadence

Re-run the security review before any release tagged `minor` or higher, using
[`.claude/commands/security-review.md`](../../.claude/commands/security-review.md).
A change that weakens prompt-injection defence, secret handling, or the browser
engine's purity is a **security regression**, not a trade-off.
