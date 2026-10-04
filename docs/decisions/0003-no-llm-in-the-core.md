# 0003 — No LLM in the prompt-generation path

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainer

## Context

The expected way to build a prompt architect is to call a model: send the user's
situation to GPT/Claude/Gemini with instructions to "write a better prompt". It is
fast to build and produces fluent output.

It also breaks every guarantee this product makes.

| Guarantee | What an LLM in the loop does to it |
|---|---|
| Never invents personal facts | Fabricates plausible details ("audience: young professionals, 25–34") that the user never said, then builds on them |
| Same input → same output | Non-deterministic; two runs give different prompts, so nothing is reproducible or testable |
| Never overstates a model | Confidently describes features that may not exist |
| Inspectable reasoning | Reasoning is opaque; behaviour cannot be unit-tested |
| Works offline, no key | Requires network, an account and a billable key |

The decisive one is the first. A prompt that silently invents a constraint about
the user is worse than no prompt, because the user cannot tell which parts of the
output are theirs and which were fabricated.

## Decision

**The prompt-generation path contains no model.** Classification, extraction,
strategy, construction, red-teaming and scoring are deterministic rule-based
functions over explicit data tables.

A provider may be configured **only** as an optional post-processing refinement
step, subject to three rules:

1. It runs **after** the engine has finished. It cannot change classification,
   scoring, safeguards or assumptions.
2. It is **server-side only**. Keys are environment variables, never sent to the
   browser.
3. Its involvement is **labelled** in the output, so a reader always knows which
   lines came from rules and which were reworded.

With no provider configured — the default, and how the deployed app runs —
behaviour is fully deterministic.

## Consequences

**Good.** The honesty guarantees are structural rather than aspirational: there is
no component that *can* invent a fact. Every line of output is testable and
traceable. Same input always yields the same prompt. No key, no cost, no network.

**Bad.** No semantic understanding. Genuinely novel phrasing — a metaphor, a
badly malformed sentence — is classified weakly and falls back to a generic
archetype. An LLM would handle those cases better.

**Bad.** Adding a new domain means writing a new taxonomy entry and recipe by
hand rather than relying on general knowledge.

**Mitigations.**

- A generic archetype exists and is *honest* about being generic, rather than
  pretending to domain expertise.
- The classification evidence is surfaced, so a wrong classification is visible
  instead of silent.
- `--target` and the task-type selector let a user override classification
  directly, which is the escape hatch for novel phrasing.

## Alternatives considered

- **LLM generates the whole prompt.** Rejected: see the table above.
- **LLM fills gaps when rules are unsure.** The most tempting middle path.
  Rejected for now because there is no way to keep "never invents facts"
  structurally true once a model can write into the prompt body. If revisited,
  model-written text must be confined to a clearly labelled section and must
  never touch classification, scores or safeguards.
- **Small local model (e.g. a quantised classifier) shipped to the browser.**
  Rejected: it would require a multi-megabyte download, breaking the fast,
  dependency-free property.

## Revisit if

The fallback quality on novel input becomes the dominant complaint, and a design
can be found where model output is provably confined to a labelled, non-structural
section — with the honesty guarantees still enforced by tests rather than by
convention.
