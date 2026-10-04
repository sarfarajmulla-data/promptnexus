# PromptNexus

**Turn any idea into the right AI prompt.**

Describe what you want to accomplish in plain language. PromptNexus works out
what you actually need, builds a prompt for the specific model you are using,
breaks it on purpose to find the weak points, repairs them, and scores the
result honestly.

Zero dependencies. No API key required. Deterministic — the same input always
produces the same prompt, byte for byte.

```
"help me revise for my dbms exam next week"
        │
        ├─ classified as  exam preparation · level 2/5
        ├─ techniques     spaced self-testing · Socratic checking · constraints
        ├─ red-teamed     3 failure modes found and repaired in place
        └─ delivered      a 3,000-character prompt with a rubric and a revision plan
                          scored 67/100 · "usable" · with the levers to push it higher
```

---

## Why this is not another prompt rewriter

Most prompt tools send your request to a model and ask it to write a better
prompt. That approach has a specific failure mode: **it invents facts about
you.** Ask for a blog-post prompt and it will helpfully add "audience: young
professionals aged 25–34" — a fabrication you never said, which then contaminates
everything downstream.

PromptNexus is a rule engine, not a model. That is what makes it able to promise:

| Guarantee | How it is enforced |
|---|---|
| Never invents personal facts | Unknown details become **labelled assumptions** you can correct |
| Never overstates a model's abilities | Every non-generic capability flag is `verified: false` and surfaced as such |
| Never inflates a score | Right-sizing is scored; padding loses points. Calibration is printed with every score |
| Never obeys pasted content | Injection attempts are stripped, reported, and defended against in the output |
| Never hides its reasoning | Line-level provenance: every line traces to a rule, a technique or a repair |
| Same input → same output | Pure functions, no randomness, no network, no clock |

---

## Quick start

```bash
git clone https://github.com/sarfarajmulla-data/promptnexus.git
cd promptnexus

npm start                       # app + API on http://localhost:4317
npm test                        # 56 tests
npm run build                   # copy the browser-safe engine to public/engine
```

There is nothing to install. There are no dependencies. If `node_modules`
appears, something has gone wrong.

`npm install` is safe to run for one reason only: it installs the git hooks.

### CLI

```bash
node src/cli/promptnexus.mjs "help me plan a week-long trip to Kerala on a mid budget"
node src/cli/promptnexus.mjs improve "<paste a weak prompt>"
node src/cli/promptnexus.mjs compress "<paste a bloated prompt>"
node src/cli/promptnexus.mjs test "<paste a prompt>"          # 8-scenario failure simulation
node src/cli/promptnexus.mjs compare "<prompt A>" "<prompt B>"
node src/cli/promptnexus.mjs demo                             # six worked examples
cat notes.txt | node src/cli/promptnexus.mjs --minimal        # pipe anything in
```

### HTTP API

```bash
curl -X POST localhost:4317/api/generate \
  -H 'content-type: application/json' \
  -d '{"input":"build my portfolio website","targetId":"claude","explain":true}'
```

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Liveness plus a real engine self-check |
| `GET /api/targets` | Model profiles, task taxonomy, quality and mode options |
| `POST /api/generate` | Situation → optimised prompt |
| `POST /api/analyze` | Tools: `improve`, `expand`, `compress`, `test`, `translate`, `compare`, `score` |

---

## Deploy to Vercel

The repository is already configured. Import it and deploy — no build settings
to change.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/sarfarajmulla-data/promptnexus)

**Or from the terminal:**

```bash
npm i -g vercel
vercel link            # connect to your Vercel account
vercel                 # preview deployment
vercel --prod          # production
```

### What Vercel does with this repo

| Setting | Value | Why |
|---|---|---|
| Build command | `npm run build` | Copies the engine to `public/engine/` and fails the build if the engine has stopped being browser-safe |
| Output directory | `public` | Static UI, no bundler, no framework |
| Functions | `api/*.js` | `generate`, `analyze`, `targets`, `health` — 1024 MB, 15 s timeout |
| Rewrites | all non-API paths → `/index.html` | Client-side routing |
| Headers | immutable caching for `/engine/*` and assets; `nosniff`, `Referrer-Policy`, `Permissions-Policy` globally | — |

### Environment variables

**None are required.** The app runs fully on the deterministic engine with no
configuration at all. Optional variables are documented in
[`.env.example`](./.env.example); the only ones that matter are for provider
refinement, and they are read server-side only — a key is never sent to the
browser.

### Why it works offline

`npm run build` copies `src/core/**` into `public/engine/`. The engine has no
Node-only imports, so the browser can import the exact same code the API uses.
If the serverless function is ever unreachable — offline, cold failure, a
sandboxed preview — the UI loads the engine from disk and computes the identical
result locally. The status chip in the header always says which is running.

---

## How it works

```
input
  │
  ├─ 1  understand     strip meta-framing, find the real objective
  ├─ 2  classify       63 categories · weighted keyword/phrase/regex signals · multi-label with evidence
  ├─ 3  extract        requirements (MUST/SHOULD/OPTIONAL), conflicts, authority, unknowns
  ├─ 4  target         22 model/tool profiles · capability flags · honest about what is assumed
  ├─ 5  complexity     1–5, with per-category floors
  ├─ 6  clarify        ≤3 questions, only ones that would change the output; otherwise labelled assumptions
  ├─ 7  strategy       ~50 techniques, cost-budgeted and capability-gated — only what helps
  ├─ 8  construct      archetype recipe over a shared section library (or a media-prompt shape)
  ├─ 9  red-team       18 failure modes · repairs applied in place, then reported
  ├─ 10 verify         13 quality checks
  └─ 11 score          12 weighted dimensions → /100 with weaknesses and top levers
                       + variants, workflow, translation, provenance, hand-off
```

### What you get

**🎯 Understood goal** · **🧠 Strategy** · **📋 The prompt** · **⚙️ How to adapt it**
**📊 Quality score /100** — and, uniquely, **🔍 line-by-line provenance**.

```bash
node src/cli/promptnexus.mjs "my node script that uploads a csv keeps timing out" --why
```

```
  DEBUGGING SPEC   5 lines
    [archetype]        Reproduce the fault from the evidence given…
  PROCESS   2 lines
    [technique: Hypo…] 1. Form a ranked list of hypotheses, most probable first…
  QUALITY CRITERIA   8 lines
    [quality bar]      - **Requirement coverage** — every MUST is visibly satisfied…
    [red-team repair]  Before finishing, confirm the answer does not depend on…
```

Every line resolves to **your own words**, **a selected technique**, **a domain
section**, **a task-class default**, or **a red-team repair**. A test asserts that
no line in a generated prompt lacks a source.

---

## Interfaces

| Surface | Where | Notes |
|---|---|---|
| Beta UI | `public/` | Create · Optimize · Test · Compare · Templates · Library · Settings. Command palette, keyboard shortcuts, dark/light, reduced motion, full keyboard navigation |
| CLI | `src/cli/promptnexus.mjs` | 11 commands, `--json`, `--minimal`, `--why`, `--out`, pipes |
| HTTP API | `api/` | Serverless functions over the same core |
| Library | `src/core/index.mjs` | `architect(input, options)` |

### Keyboard

| Keys | Action |
|---|---|
| `⌘/Ctrl + Enter` | Generate |
| `⌘/Ctrl + K` | Command palette |
| `⌘/Ctrl + S` | Save to library |
| `⌘/Ctrl + Shift + C` | Copy prompt |
| `Esc` | Close palette, dropdown or modal |

---

---

## Honest limitations

- **Scores measure specification quality, not model output.** No model is
  invoked. The UI prints this calibration next to every score.
- **Model profiles are design assumptions.** Features change monthly; each
  profile is marked `verified: false` and the generated prompt states its own
  assumptions so you can correct them.
- **Classification is heuristic.** Solid on tested cases, weaker on genuinely
  novel phrasing, where it falls back to a generic archetype and says so.
- **No semantic understanding.** A novel metaphor will be handled less well than
  a literal request. Adding a model for this would cost determinism and the
  guarantees above — see [`docs/decisions/0003-no-llm-in-the-core.md`](./docs/decisions/0003-no-llm-in-the-core.md).

---

## Testing

```bash
npm test
# tests 37
# pass 37
# fail 0
```

Covers engine behaviour on real inputs, determinism, capability honesty,
injection defence, question limits, media-prompt compactness, knowledge-table
integrity, and full traceability of every generated line. CI additionally
asserts zero dependencies, engine purity, and that the build output exists.

---

## Repository layout

```
src/core/            the engine — pure, browser-safe, zero dependencies
  knowledge/         taxonomy (63), model profiles (22), techniques (~50)
  pipeline/          one file per stage
  templates/         section library + 23 archetype recipes
api/                 Vercel serverless adapters (thin — logic lives in core)
public/              UI: HTML, CSS, ES modules. No build step
  engine/            generated by npm run build (gitignored)
tests/               56 tests across four suites
docs/                design, engineering and operations documentation
.githooks/           version-controlled git hooks (secret scan, syntax, guards)
.github/             CI, CodeQL, Dependabot, issue forms, PR template, CODEOWNERS
```

## Documentation

| Document | What it covers |
|---|---|
| [System design](./docs/system-design.md) | Problem, users, requirements, and an explicit out-of-scope list |
| [Architecture](./docs/architecture.md) | Pipeline stages, data contracts, extension points |
| [App flow](./docs/app-flow.md) | Screens, navigation, the six core journeys, edge cases |
| [Design brief](./docs/design-brief.md) | Colour, type, spacing, components, motion, the ambient field |
| [Implementation plan](./docs/implementation-plan.md) | Build order, what shipped, what is deferred and why |
| [API conventions](./docs/api-conventions.md) | Endpoints, error shape, status codes, result contract |
| [Testing](./docs/testing.md) | Strategy, coverage, what is deliberately untested, CI gates |
| [Permissions](./docs/permissions.md) | The access model — and the rules if accounts are ever added |
| [Hosting](./docs/hosting.md) | Platform, cost at launch / 10× / 100× |
| [Caching](./docs/caching.md) | What is cached, and what is never cached |
| [Monitoring](./docs/monitoring.md) | What is observed, and an honest list of what is not |
| [Threat model](./docs/security/threat-model.md) | Assets, entry points, threats, accepted gaps |
| [Decision log](./docs/decisions/) | Why the architecture is shaped this way |
| [Runbooks](./docs/runbooks/) | Deploy · rollback · incident response |

## Contributing

Read [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) and
[`CONTRIBUTING.md`](./CONTRIBUTING.md). The short version: zero dependencies,
`src/core` stays pure, one implementation per behaviour, and the honesty rules are
not negotiable.

```bash
npm run hooks          # install git hooks (secret scan, syntax check, guards)
npm run scan           # scan tracked files for credentials
npm run scan:history   # scan every blob in git history
```

See [SECURITY.md](./SECURITY.md) for the security policy and private reporting.

## License

[MIT](./LICENSE)
