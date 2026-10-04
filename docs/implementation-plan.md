# Implementation plan

Ordered milestones in build order, what each proved, and what is deliberately
deferred. Kept current — a plan that is not updated becomes a fiction.

---

## Shipped

### M1 — Engine core ✅

**Goal:** a deterministic pipeline that turns a sentence into a structured prompt.

Built: understanding, classification (63 categories, weighted signals, evidence),
requirement extraction with conflict detection, target detection (22 profiles),
complexity 1–5 with per-category floors, strategy selection (~50 techniques,
cost-budgeted and capability-gated), construction (23 archetype recipes over a
shared section library, plus a media shape), adversarial review (18 failure modes
with in-place repair), scoring (12 dimensions) and assembly.

**Verified by:** `tests/engine.test.mjs` — real inputs, determinism, capability
honesty, question limits, media compactness.

### M2 — Interfaces ✅

**Goal:** one engine, three ways in.

Built: CLI (11 commands, JSON output, pipes), HTTP API (4 endpoints), library export.

**Verified by:** `tests/tools.test.mjs` for the tool modes
(compress/test/compare/translate/improve) and `tests/api.test.mjs` for the HTTP contract.

### M3 — Provenance ✅

**Goal:** make the engine auditable rather than merely plausible.

Built: every rendered line is registered against its origin (your words, a
technique, an archetype section, a task-class default, or a red-team repair);
`--why` prints the map with a summary breakdown; the UI has a Line sources panel.

**Verified by:** a test asserting that **no line in a generated prompt lacks a source**.
This caught a real bug: `tidyPrompt` normalised typography after rendering, so the
prompt text and its section list could drift apart.

### M4 — Beta UI ✅

**Goal:** a product, not a mockup.

Built: eight views, command palette, keyboard shortcuts, accessible searchable
listboxes, focus-trapped modals, toasts, dark/light themes, reduced motion,
responsive layout to 375 px, and the ambient canvas field.

**Verified by:** id/class/navigation reference audits, syntax checks, and the API
contract tests exercising the same endpoints the UI calls.

### M5 — Deployment ✅

**Goal:** zero-configuration deploy with a real offline path.

Built: `vercel.json` (static output, functions, rewrites, cache and security
headers), a build step that **fails** if the engine stops being browser-safe, and
the service abstraction that falls back to the in-browser engine.

**Verified by:** `docs/runbooks/deploy.md` checklist; a full local simulation of
every CI step.

### M6 — Injection hardening ✅

**Goal:** close the gaps the API tests exposed.

Found and fixed three: undetected override phrasings; strip patterns leaving
residue (removing "you are now X" from "SYSTEM: you are now X" left a bare
`SYSTEM:`); and — the serious one — **a payload could become the objective** when
sanitised residue held no usable task, because the goal fell back to the
raw headline.

Containment is now structural rather than a list of phrases: residue must pass
`looksLikeTask()` on its own merits, and the raw headline is never used as a
fallback once an attempt is flagged.

**Verified by:** eight attack phrasings with no leaks and no false positives on
ordinary instructions such as "ignores blank lines" and "act as a senior editor".

### M7 — Repository and documentation ✅

Built: README, CONTRIBUTING, SECURITY, CHANGELOG, CODEOWNERS, issue forms, PR
template, Dependabot, CI with five gates, CodeQL, release notes config, secret
scanning in pre-commit, decision log 0001–0003, and this documentation pack.

---

## Deferred

| Item | Why deferred | What would unblock it |
|---|---|---|
| **Provider routing** | The contract is written but not implemented; the open question is whether model-touched text can be provably confined to a non-structural section | A design where the honesty guarantees stay enforced by tests, not convention |
| **Library sync across devices** | Requires accounts and server-side storage, which the current privacy stance avoids | A decision to accept accounts, with the storage and privacy consequences |
| **Non-English taxonomy signals** | English-only signal tables; classification degrades rather than failing | Signal tables per language, or a language-detection pre-stage |
| **Saved-history timeline** | The Library covers retrieval; a timeline would compete with it | Evidence that users need chronology rather than retrieval |
| **Plugin/technique authoring from the UI** | Technique cards are code with a `render()` contract; a UI editor would need a safe subset | A declarative technique format that can be authored without arbitrary code |
| **Load testing** | There is no server-side compute to load: the engine is pure and the API is stateless | Provider routing, which would introduce real external latency and cost |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A contributor adds a dependency | Medium | Medium | CI fails on any dependency; CONTRIBUTING explains why |
| A contributor moves logic out of `src/core` | Medium | High | CI purity guard; one-implementation rule in CONTRIBUTING and CODEOWNERS review |
| Model capability flags drift from reality | High (features change monthly) | Low — they are labelled `verified: false` and surfaced as assumptions | The generated prompt states its own assumptions so the user can correct them |
| Honesty rules quietly weakened by a "nicer" change | Low | High | Each rule has a test; the rules are listed in AGENTS.md as non-negotiable |
| Browser-local library lost | Low | Medium | Export to JSON; wipe requires confirmation; nothing is silently deleted |

## Build order rationale

The sequence follows dependency, not fashion: the engine before the interfaces,
provenance before the UI that displays it, the offline path before deployment, and
hardening before polish — because a beautiful prompt generator that can be
manipulated into rendering an attacker's payload is not a product.
