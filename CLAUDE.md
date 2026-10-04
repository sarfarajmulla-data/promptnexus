# Project: PromptNexus

## What this product does

Turns a plain-language description of a situation into an optimised, model-aware
prompt. It classifies the request, extracts requirements, detects the target
model, assesses complexity, selects only the prompting techniques that help,
red-teams the result and scores it honestly. The engine is deterministic and
dependency-free: the same input always produces the same prompt.

## Stack (do not change without asking)

- Runtime: Node 18+ (`engines.node >= 18`), ESM only, **zero runtime dependencies**
- Core engine: `src/core/**` — pure functions, browser-safe, no `node:` imports
- Local server: `src/server/server.mjs` — `node:http` only
- Serverless API: `api/*.js` — Vercel Node functions, thin adapters over the core
- Frontend: `public/**` — plain HTML/CSS/ES modules, **no build step, no bundler**
- Hosting: Vercel (static `public/` + `api/` functions)

## Rules

- **Zero dependencies.** Adding one requires a written justification and approval.
- **The engine stays deterministic.** No randomness, no clock, no network inside `src/core/`.
- **No `node:` imports in `src/core/`.** `npm run build` fails the build if any appear.
- **One source of truth per behaviour.** Scoring, evaluation and classification live in
  `src/core`; the API and the browser both import them. Never re-implement in `public/`.
- **No secrets in the repo or the client.** Provider keys are server-side env vars only.
- **No invented facts in generated prompts.** Unknowns become labelled assumptions.
- **Never claim unverified model capabilities.** `verified: false` is the default; keep it.
- **Run the full check before saying a task is done:** `npm test && npm run build`.
- Prefer small, reviewable changes. One concern per commit.

## Commands

```bash
npm start        # local app + API on :4317
npm test         # 37 tests: engine behaviour, knowledge integrity, traceability, tool modes
npm run build    # copy the browser-safe engine to public/engine (Vercel build step)
npm run cli -- "describe your situation"
npm run demo     # six worked examples with scores
```

## Architecture decisions

See `/docs/decisions/` for the decision log and `/docs/architecture.md` for the design.
Update this file whenever a decision changes the shape of the system.
