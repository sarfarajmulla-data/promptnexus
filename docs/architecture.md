# PromptForge — Architecture

This document explains how a messy request becomes a finished prompt, and why each stage is shaped the way it is.

## 0. Shape of the system

```
                     ┌───────────────────────────────────────────┐
   one sentence  →    │  engine.mjs — the operating loop          │
   or an essay       │  understand → classify → extract → clarify │
                     │  → strategy → build → red-team → score     │
                     └───────────────────────────────────────────┘
                                       │
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
   knowledge/                     templates/                     pipeline/
   taxonomy  (63 tasks)           SECTIONS (builders)            util/ (text, match, trace)
   targets   (22 models)          RECIPES  (archetypes)
   techniques(50 methods)         CATEGORY_RECIPE (task → recipe)
```

Everything is plain ESM with no dependencies, so the same engine runs in Node, in the browser and inside a serverless function.

## 1. Understand and classify

**Intent** (`detectIntent`) strips conversational framing — "can you help me…", "i want you to…", "give me a prompt that…" — so the objective is measured against the real request. The stripped form is kept too, because framework names often appear in the framing.

**Classification** (`classifyCategories`) scores every category against weighted signals:

| Signal type | Weight | Matching |
|---|---|---|
| keyword | 1.0 | word-boundary match, so "sql" doesn't fire inside "mysql" |
| phrase | 2.2 | substring, so "literature review" beats two unrelated keywords |
| regex | 1.6 | structural patterns, e.g. `\d+ day trip` |

Scores are damped by input length so a two-word request cannot trigger everything. The top four within a margin are kept (multi-label), and the leader's matched signals are recorded as evidence and shown in the UI.

**Domain overrides** exist because surface vocabulary legitimately out-scores domain context: *"write a 2000 word essay for my coursework"* matches "write a" (phrase, 2.2) while "coursework"/"apa" match as keywords. Overrides for academic, exam-prep, debugging, coding and research promote the domain when a high-confidence marker fires, demoting the previous leader into the secondary list so it still informs the build. Each override records its reason.

**Complexity** is scored from brief length, category breadth, requirement count, multi-stage language, evidence needs, target capability and detected conflicts — then floored by `CATEGORY_MIN_LEVEL`, because a decision brief or system design cannot be answered in one flat step regardless of how tersely it was asked for. The level drives technique budget and prompt weight, so this is the single most consequential judgement in the engine.

## 2. Extract requirements

`extractSpec` converts prose into structure: objective, topic, deliverable, context, audience, inputs, requirements by force level, constraints, forbidden content, unknowns and conflicts.

Design rules:

- **Questions are the task, not the requirements.** `isQuestionLike` prevents "should I take the internship?" being filed as a SHOULD requirement.
- **Force levels are read from the user's own words** — must/should/optional/avoid — and bullet lists default to SHOULD.
- **Never invent personal information.** Audience, tone, length, academic level, country and budget are only extracted when the text supports them. Academic level additionally requires an academic context, so "a masters in AI" (a thing being considered) is not mistaken for the required standard of the output.
- **Conflicts are detected deliberately**, not resolved silently: "short" + "exhaustive", "free" + "premium", "beginner" + "expert". The prompt then states a priority order and requires the model to name the trade-off it chose.

## 3. Clarify — the minimum necessary

`assessMissingInformation` uses per-category question banks with materiality ratings. It asks at most three questions, only when the answer would materially change the prompt, never for information already given, and never at all if the user said "just do your best", "you decide" or equivalent. Every unasked question becomes an assumption with a stated default, listed in the output for correction.

This is a deliberate inversion of the usual chat pattern: **the user always leaves with a usable prompt**, and the questions are an optional refinement path.

## 4. Strategy selection

Fifty techniques, each declaring family, cost (1–3), risk, complexity band, evidence signals, required capabilities, applicability (`when`) and a renderer that emits instruction text.

Selection is budgeted:

```
budget = COST_BUDGET[complexity]        // 2 … 11
       − small-context targets           // small models: shorter prompts win
       × quick-mode damping
       + advanced-mode allowance
```

Techniques are gated first (capability requirements must be satisfiable by the target profile; the complexity band must fit or be strongly evidenced), then scored (category defaults, evidence in the request, verification needs, media penalties), then chosen greedily by score within budget. Required families are back-filled per level, so a level-4 task always has a process step and an evaluation step even if nothing matched strongly.

The result is usually 1–5 techniques. The engine does not "use every technique" — a technique that does not change the output is noise that dilutes attention.

## 5. Construction

Two output shapes:

1. **Linguistic prompts.** A section library (`SECTIONS`) with one builder per architectural block, plus per-archetype recipes that order and select them (23 recipe types: research, academic, teaching, engineering, debug, build, agent, media, high-stakes, meta, …). Builders return `null` when they have nothing to say, so empty sections never appear. The section order follows the architecture: role → mission → context → objective → inputs → requirements → constraints → priorities → process → quality → verification → output → edge cases → failure handling → final rules.

2. **Media prompts.** Image and video models condition on dense description, not specification. `buildMediaPrompt` assembles subject → framing → lighting → style → colour → detail, extracts explicit exclusions, and adapts the shape to the model family (Midjourney parameters, Stable Diffusion's separate negative field, single-shot video structure).

## 6. Red-team and repair

`adversarialReview` checks eighteen failure modes against the assembled prompt: ambiguity, conflicts, verbosity, missing context, wrong role, output-format drift, unsupported capabilities, hallucination risk, injection, context contamination, over-constraint, under-specification, unrealistic expectations, hidden assumptions, missing edge cases, target incompatibility, plus defensive-security scoping and high-stakes boundaries.

Crucially, it **repairs rather than reports**. Repairs mutate the context and the prompt is rebuilt once:

- ambiguous reading → "resolve it explicitly and say which reading you took"
- capability gap → "if X is unavailable, say so and deliver the closest safe fallback"
- no output contract → a fallback contract derived from the task class
- long input → a precedence rule so volume cannot dilute requirements
- implied guarantee → an honest certainty statement
- injected instructions → stripped, reported, and a report-don't-obey rule written in

## 7. Verification and scoring

Thirteen structural quality-control checks run against the final prompt (specificity, context, completeness, precision, feasibility, output control, robustness, efficiency, hallucination resistance, verification, usefulness, target fit).

The hardness score is twelve weighted dimensions, where weights vary by task group — verification carries 1.9× for high-stakes work, output precision 1.8× for media, creativity 1.8× for creative work. Two deliberate honesty mechanisms:

- **Right-sizing is scored.** A prompt far above or below the ideal token band for its complexity level loses points, so padding is actively punished.
- **The calibration line is printed with the score.** It states that this measures the specification quality of the prompt, not predicted model output. A perfect 100 is unreachable by construction.

## 8. Output and modes

Modes are detected from the request and change the shape of the whole response: minimal (prompt only), best, improve, compare, compress, expand, translate, explain, test, advanced, beginner, expert, copy, workflow, quick.

- **Improve** diagnoses the pasted prompt structurally (20 checks), rebuilds it from the extracted spec, and reports each weakness with the fix that was applied plus a like-for-like score comparison.
- **Compress** preserves objective, constraints, output contract and verification rules, strips filler and redundancy, and reports exactly what was removed.
- **Test** predicts the eight canonical failure scenarios (ambiguous, missing, conflicting, huge, tiny, unexpected, adversarial, wrong-assumption inputs) from the safeguards present, then emits a hardened version.
- **Compare** scores both prompts across nine dimensions and explains the gap, including safeguards each one has that the other lacks.
- **Workflow** splits a task into sequential prompts with an explicit hand-off contract, used when one prompt would have to hold too many incompatible jobs.

## 9. Traceability (provenance)

Every line in a generated prompt is registered against its origin as it is built:

- `buildSections` tags each section with its builder id and the section library that produced it (`sourceFor`).
- `selectTechniques` registers each rendered technique line in `ctx.techniqueLines` (line → technique).
- `construct` snapshots the section lines *before* `adversarialReview` runs; any line that appears only after the rebuild is attributed to a repair.
- `buildProvenance` then walks the final section list and emits, per line, `{ text, source, detail }`.

Media prompts get clause-level provenance instead (`buildMediaProvenance`), separating what the user actually described from defaults the engine supplied because nothing was stated.

Because rendering always goes through `renderPromptFrom(ctx)` — the section list is the single source of truth — the prompt text and the section list cannot drift apart, and a test asserts that every line in the prompt appears in the provenance report. This is the mechanism that makes the system auditable rather than merely plausible: **no component can add a line to the prompt without a source being recorded for it.**

## 10. Testing strategy

`npm test` runs three suites:

- **engine.test.mjs** — fourteen realistic inputs, determinism (byte-identical repeat runs), capability honesty, unknown-target degradation, injection defence, minimal mode, assumptions being labelled, ≤3 questions, answers feeding back, workflow only when warranted, media compactness.
- **knowledge.test.mjs** — taxonomy uniqueness and completeness, every category mapping to a recipe with real builders, target honesty (`verified: false` for every non-generic profile with stated assumptions), `resolveTarget` never throwing, technique contract validity, and every technique rendering against a full realistic context without throwing.
- **tools.test.mjs** — analysis, compression fidelity (never introducing a word that wasn't there), failure simulation, comparison verdicts, translation, improve score deltas, hostile pasted content being treated as data, and full line-level traceability of every generated prompt.

The knowledge-integrity tests are the guardrail for contributors: adding a category without a recipe, a technique with an unknown capability gate, or a target claiming verified capabilities all fail the build.

## 11. Extension points

| Want to… | Change | Nothing else needed |
|---|---|---|
| add a task category | `taxonomy.mjs` + one line in `CATEGORY_RECIPE` | classification, extraction, strategy, scoring adapt automatically |
| add a model profile | `targets.mjs` | capability gating and formatting adapt automatically |
| add a prompting technique | `techniques.mjs` | selection, budgeting and rendering pick it up |
| add a prompt section | `templates.mjs` | reference it from any recipe |
| add a diagnostic check | `promptanalysis.mjs` `CHECKS` | improve/compress/test modes use it |
| add a failure mode | `redteam.mjs` | repair + reporting wired automatically |
