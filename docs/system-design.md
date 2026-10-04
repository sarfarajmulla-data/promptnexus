# System design

**Status:** approved · **Last updated:** 2026-10-04

---

## Problem statement

Writing an effective prompt for an AI model is a skill most people do not have and
should not need. A person knows what they want to accomplish; they do not know
that a coding task needs ranked hypotheses and a discriminating test, that a
research task needs source classification, or that a model's context budget should
change the structure of the request.

Existing tools solve this by asking a model to rewrite the prompt. That introduces
a specific hazard: the model invents details the user never supplied — an audience
segment, a tone, a length — and those fabrications silently become constraints in
the final prompt. The user cannot tell which parts of the output are theirs.

## What this product is

A deterministic prompt compiler. It reads a plain-language description of a
situation, works out what the request actually needs, and emits a structured
prompt tuned to a specific model — with every line traceable to a rule.

## Who it is for

| User | What they need |
|---|---|
| **Primary:** a technically literate person who uses several AI tools | One reliable way to turn an intent into a good prompt, without learning prompt engineering per model |
| **Secondary:** a developer integrating prompt generation | An HTTP API and a library, in one dependency-free package |
| **Tertiary:** a prompt engineer | Visible strategy, provenance and honest scoring, so they can audit and override |

## Core workflows

1. **Describe → generate.** A sentence in, a scored, red-teamed prompt out.
2. **Paste → improve.** An existing weak prompt is diagnosed, rebuilt, and scored against the original.
3. **Compare → choose.** Up to three prompts are scored on identical metrics with a winner and merge advice.
4. **Browse → adapt.** A template or a saved prompt is loaded, two lines changed, regenerated.
5. **Integrate → call.** The API or library is used directly, with the same engine.

## Functional requirements

| # | Requirement |
|---|---|
| F1 | Accept arbitrary input: one word, a paragraph, an emotional complaint, a pasted document |
| F2 | Classify the request across a domain taxonomy, with visible evidence for the choice |
| F3 | Detect the target model and adapt length, structure and formatting to it |
| F4 | Assess complexity 1–5; generate multi-step workflows or agent specs at 4–5 |
| F5 | Select only techniques that materially help — never a fixed checklist |
| F6 | Ask at most three questions, and only ones that would change the output |
| F7 | Label every unknown as an assumption instead of inventing an answer |
| F8 | Red-team the result and repair it before delivery, reporting both |
| F9 | Score honestly, with weaknesses and the levers that would raise the score |
| F10 | Expose how every line was produced (provenance) |
| F11 | Run with no key, no network, and no account |
| F12 | Be usable via UI, CLI and HTTP API from one engine |

## Non-functional requirements

| Attribute | Target |
|---|---|
| **Determinism** | Identical input → byte-identical output. Asserted in CI |
| **Dependencies** | Zero at runtime. Asserted in CI |
| **Offline** | Full generation works with no network |
| **Latency** | Engine completes in < 150 ms locally; API p95 well inside a 1 s budget |
| **Persistence** | None server-side. The library is local to the browser |
| **Privacy** | No accounts, no cookies, no tracking, no server-side storage of user text |
| **Accessibility** | Full keyboard operation, visible focus, reduced-motion support, AA contrast |
| **Portability** | Node 18+, modern browsers, no build step required to serve the UI |

## Architecture at a glance

See [`architecture.md`](./architecture.md) for the full design and
[`decisions/`](./decisions/) for why it is shaped this way.

```
browser ─┬─ /api/*  (Vercel functions)  ─┐
         └─ /engine/* (identical code)  ─┴─ src/core  ← single implementation
CLI ──────────────────────────────────────┘
```

## Out of scope

Naming these explicitly is what stops them being added by accident.

- **No accounts, teams, or multi-tenancy.** There is no server-side user data, so
  there is nothing to isolate, share, or permission. (See [`permissions.md`](./permissions.md).)
- **No model invocation in the generation path.** Deliberate — see
  [`decisions/0003-no-llm-in-the-core.md`](./decisions/0003-no-llm-in-the-core.md).
- **No server-side storage of prompts.** The library is browser-local by design.
- **No billing, plans or usage metering.** There is nothing to meter: no provider
  calls are made and no infrastructure scales with usage.
- **No analytics or tracking.** There is no product-analytics integration, and
  adding one would need a privacy decision first.
- **No fine-tuning or model training.** The project hosts no models.
- **No mobile application.** The web UI is responsive to 375px; a native client is
  not planned.

## Open questions

1. **Provider routing.** The contract is written
   ([`decisions/0003`](./decisions/0003-no-llm-in-the-core.md), "Revisit if") but not
   implemented. It needs a decision on whether model-touched text can ever be
   confined to a labelled, non-structural section.
2. **Library portability.** Browser-local storage means a user cannot move their
   library between devices. Export/import exists; sync does not.
3. **Non-English input.** The taxonomy signals are English-only. Classification
   degrades rather than fails, but it degrades.
