# Testing strategy

## What is tested, and why

The engine is deterministic and dependency-free, so tests are cheap and precise:
an exact input string reproduces a bug exactly. That shapes the whole approach —
**every bug fix starts with the input that caused it.**

```
tests/
  engine.test.mjs       14 tests | classification, determinism, honesty, question limits
  knowledge.test.mjs     7 tests | data-table integrity, capability claims
  tools.test.mjs        16 tests | improve, compress, expand, test, compare, provenance
  api.test.mjs          19 tests | HTTP contract, error shaping, injection containment
  cli.test.mjs           9 tests | every command, exit codes, serve lifecycle
  robustness.test.mjs    6 tests | hostile input, ReDoS, empty input
                       ──────────
                        71 tests
```

Run everything with:

```bash
npm test        # node --test tests/*.test.mjs  → 71 tests
```

## Two suites that exist because of a real escape

`cli.test.mjs` and `robustness.test.mjs` are not speculative coverage. Each one
was written in response to a defect that shipped past the other four suites:

- **`cli.test.mjs`** — the CLI imported `start` from the server module, which
  exported nothing. Every invocation, including the published `bin` entry,
  failed to load at all. Nothing imported the CLI, so nothing noticed. The rule
  that came out of it: *anything referenced from `package.json` gets a test.*
- **`robustness.test.mjs`** — two pipeline regexes were quadratic, and one was
  catastrophic. A pasted document with thousands of blank lines never finished.
  The rule: *the input surface is arbitrary text, so the cheapest possible test
  is a hostile string with a generous time budget.*

## The four suites

### `engine.test.mjs` — behaviour

Fourteen real-world inputs (an exam, a debugging session, a life decision, a vague
business idea, an image request, a vague one-liner, a literature review, a
money question) each assert:

- a complete result of the documented shape;
- classification is stable and carries evidence;
- **determinism** — the same input twice is byte-identical;
- **capability honesty** — no non-generic model profile claims `verified: true`;
- **question discipline** — at most three questions, each with options and a default;
- **media compactness** — an image request produces one descriptive block, not fifteen sections;
- **injection defence** — a payload in pasted content never reaches the output.

### `knowledge.test.mjs` — data integrity

The engine is tables plus logic, so the tables are tested like code: no duplicate
ids, every technique declares a valid family and cost, every category's recipe
resolves to real sections, no category can be reached by an empty signal, and no
capability flag is claimed without evidence.

### `tools.test.mjs` — the tool modes

`analyzePrompt`, `compressPrompt`, `expandPrompt`, `testPrompt`, `comparePrompts`,
`translatePrompt` — including the properties that matter most: compression **never
introduces a word that was not there**, comparison never awards a win without a
reason, and hostile pasted content is treated as data.

Plus the traceability guarantee: **every line in a generated prompt appears in the
provenance report.** This test found a real bug — `tidyPrompt` normalised em
dashes to hyphens in the section list *after* rendering, so the prompt and its
sections could silently diverge.

### `api.test.mjs` — the HTTP contract

Spawns the real server on port 4399 and drives it like a client:

| Concern | Assertion |
|---|---|
| Contract | Documented fields present; score in range; dimensions ≥ 6 |
| Determinism | Two identical requests → identical prompt |
| Errors | Empty input, unknown target, malformed JSON, unknown action — all `4xx` with a usable message |
| No leakage | Error bodies contain no stack traces, paths or internals |
| Bounds | Oversized bodies refused |
| Injection | Eight attack phrasings contained; five legitimate prompts not flagged |
| Headers | `no-store`, JSON content type, `nosniff`, CORS on `OPTIONS` |

## What is deliberately not tested

| Not tested | Why |
|---|---|
| Visual appearance | No screenshot-diffing: it fails on font rendering across machines and catches nothing the reference audit misses |
| Browser behaviour (E2E) | No Playwright. The UI is thin, and the riskier layer — the engine and its guarantees — is covered directly. Reported honestly as a gap, not hidden |
| Score values themselves | Asserting an exact score would freeze a heuristic and make every improvement look like a regression. Assertions are on *properties* (in range, deterministic, right-sized better than padded) |
| Provider refinement | Not implemented; nothing to test |

## CI gates

Every pull request must pass five gates:

1. **Zero dependencies** — fails if any `dependencies` or `devDependencies` appear.
2. **Tests** — 71 tests.
3. **Build** — copies the engine to `public/engine/` and fails if any `node:` import has entered `src/core/`.
4. **Engine purity** — a grep guard for Node built-ins in the engine.
5. **Smoke test** — starts the server, checks `/api/health`, generates a prompt, and asserts no injection payload appears in the output.

CodeQL runs weekly for static analysis of the JavaScript.

## Rules for contributors

1. **Never edit a test to make it pass.** Fix the code. If the test is wrong, say
   why in the pull request — that is a different, reviewable claim.
2. **A bug fix starts with a failing test** that reproduces it.
3. **New behaviour ships with a test** naming the behaviour, not the function.
4. **Assert properties, not constants**, wherever a value is a judgement call.
5. **Prefer a real input string** over a synthetic one. Real inputs are what broke
   things the first time.

## Manual verification before release

```bash
npm test && npm run build
npm start                                        # then, in another shell:
curl -s localhost:4317/api/health                # all four checks true
curl -s -X POST localhost:4317/api/generate \
  -H 'content-type: application/json' \
  -d '{"input":"help me revise for my dbms exam"}'   # score and a substantial prompt
npm run demo                                     # six cases, classification and score
```

Then in the browser: generate a prompt, copy it, save it, find it in the Library,
confirm `⌘K` opens the palette and `Esc` closes it, and check the layout at 375 px.
