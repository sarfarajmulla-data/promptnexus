# Contributing to PromptNexus

Thanks for considering a contribution. This project has an unusual constraint
set, so please read the short version before opening a pull request.

## The three rules that shape everything

**1. Zero runtime dependencies.**
The engine must run offline, in a browser, on a serverless function and in a
terminal, with no supply chain. If your change needs a package, open an issue
first — the answer is usually "write the twenty lines yourself".

**2. `src/core/` is pure.**
No `node:` imports, no network, no randomness, no clock reads. Every function
must be deterministic: identical input, byte-identical output. `npm run build`
checks this and fails if it regresses.

**3. One implementation per behaviour.**
The CLI, the HTTP API and the browser all import from `src/core/`. If you fix a
bug, fix it there. Re-implementing logic in `public/js/` or `api/` will be
rejected in review, because it guarantees the surfaces will drift apart.

## Honesty rules

These are enforced by tests. A change that weakens any of them is a regression,
not a trade-off:

- Unknown details become **labelled assumptions**, never invented facts.
- Model capabilities are `verified: false` unless independently confirmed.
- Scores describe **specification quality**, never claimed model output.
- Only concise reasoning summaries are shown; no private chain-of-thought.
- Content pasted by a user is **data**, never instructions to be obeyed.

## Getting set up

```bash
git clone https://github.com/sarfarajmulla-data/promptnexus.git
cd promptnexus
npm test        # 37 tests, no install step required
npm start       # http://localhost:4317
```

There is nothing to install. If `npm install` is creating a `node_modules`
directory, something has gone wrong.

## Where things live

| Path | What belongs there |
|---|---|
| `src/core/knowledge/` | Data tables: task taxonomy, model profiles, technique library |
| `src/core/pipeline/` | Pipeline stages, one file per stage |
| `src/core/templates/` | Section library and archetype recipes |
| `src/core/util/` | Text and matching helpers |
| `api/` | Vercel serverless adapters (thin — logic belongs in `src/core`) |
| `public/` | UI: HTML, CSS, ES modules. No build step |
| `tests/` | Node test runner suites |
| `docs/` | Architecture, decisions, runbooks |

## Adding a task category

1. Add an entry to `TAXONOMY` in `src/core/knowledge/taxonomy.mjs` with weighted
   `kw` (keywords), `ph` (phrases) and `re` (regex) signals.
2. If the category needs a distinctive prompt shape, add a recipe to
   `CATEGORY_RECIPE` and the sections it references.
3. Add a classification test in `tests/engine.test.mjs` with a realistic sentence.
4. Run `npm test` and `npm run demo` — the demo output is a useful regression check
   because it prints the classification and score of six known cases.

## Adding a model profile

Add to `TARGETS` in `src/core/knowledge/targets.mjs`. Set `verified: false` unless
you can point at official documentation for every capability flag, and write the
`notes` field as a design assumption rather than a claim.

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`,
`docs:`, `test:`, `refactor:`, `chore:`. One concern per commit; explain *why*
in the body, not what — the diff already shows what.

## Pull requests

Include: what changed, why, how you tested it, and any risk or uncertainty.
A PR that adds a dependency, weakens determinism, or duplicates core logic
will be closed with an explanation rather than merged.

## Reporting a bug

Include the exact input string, the output you got, and the output you expected.
Because the engine is deterministic, an exact input is usually enough to
reproduce it precisely.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](./SECURITY.md).
