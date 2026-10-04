# PromptNexus

**A Universal AI Prompt Architect.** Describe your situation in ordinary language — messy, vague, emotional or half-formed — and PromptNexus works out what you actually need and writes the prompt that gets it.

It is not a sentence rewriter. It classifies the task, infers the real objective, decides which prompting techniques pay off, adapts to your target model, red-teams its own output, repairs what it finds, and scores the result honestly.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  you: "i need help revising for my dbms exam next week, i keep           │
│        forgetting normalization"                                         │
│                                                                          │
│  promptnexus: exam-prep · level 2/5 · exam coach persona ·                │
│               rubric-based practice · spaced self-testing · 67/100        │
│                                                                          │
│  → a copy-paste prompt that makes any capable model teach you the        │
│    topic properly instead of dumping a summary at you                    │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Why it exists

Most "prompt generators" take your sentence and pad it with adjectives. That fails for the same reason your original sentence failed: the model still has to guess what you meant.

PromptNexus does the work a senior prompt engineer would:

1. **Understand** — extract intent, objective and deliverable from unstructured language.
2. **Classify** — 63 task categories, multi-label, with evidence for every decision.
3. **Detect the target** — 22 model/tool profiles, each with honest capability flags.
4. **Assess complexity** — 5 levels, from single-step to agentic, with the reasons stated.
5. **Find what's missing** — ask only when the answer would materially change the prompt.
6. **Choose strategy** — 50 techniques, budgeted by cost and gated by capability.
7. **Build** — a section architecture adapted per task archetype.
8. **Red-team** — 18 failure modes checked; what can be fixed is fixed before you see it.
9. **Verify** — 13 quality-control checks against the assembled prompt.
10. **Score** — 12 weighted dimensions, conservatively, with improvement levers.

## Quick start

```bash
git clone https://github.com/sarfarajmulla-data/promptnexus
cd promptnexus

# web app + JSON API  (http://localhost:4317)
npm start

# CLI — no install, no dependencies
node src/cli/promptnexus.mjs "help me write a cover letter for a data analyst internship"
node src/cli/promptnexus.mjs "should i take the internship or finish my degree?" --target claude
node src/cli/promptnexus.mjs "build me a portfolio site" --workflow --advanced
node src/cli/promptnexus.mjs "just give me the prompt for a cold email to a recruiter" --minimal

# prompt tools
node src/cli/promptnexus.mjs improve "<paste any prompt>"
node src/cli/promptnexus.mjs compress "<paste a prompt that is too long>"
node src/cli/promptnexus.mjs test "<paste a prompt you do not trust yet>"
node src/cli/promptnexus.mjs compare "<prompt one>

vs

<prompt two>"

# tests
npm test
```

Pipes and JSON work as you'd expect:

```bash
cat notes.txt | promptnexus improve --minimal > better.md
echo "plan my revision week" | promptnexus --json | jq '.score.total, .strategy.techniques[].id'
```

## What it produces

The output is designed to be pasted straight into ChatGPT, Claude, Gemini, a coding agent or an image model:

```markdown
## 1. SYSTEM ROLE
You are a decision analyst specialising in decision support.
You also bring the judgement of a career strategist…

## 2. MISSION
Deliver: a decision brief ending in a recommendation and its flip conditions.
…
## 10. OUTPUT FORMAT
Return a decision brief: options table, then recommendation, then what would change it.
```

Alongside the prompt you get: the understood goal, the strategy with reasons, the technique list with risks, which failure modes were found and repaired, the assumptions that were made, optional clarifying questions with selectable options, three versions (lean / balanced / maximum), an optional multi-prompt workflow, and a machine-readable hand-off block.

## Design principles

These are enforced in code and tested:

| Principle | How it is enforced |
|---|---|
| **Never invent personal information** | Anything not stated becomes a *labelled assumption* listed in the prompt and flagged for correction — never a silent fabrication. |
| **Never claim model capabilities it can't verify** | Every target profile carries `verified: false` and its design assumptions. Techniques are gated by capability flags. A missing capability becomes a stated limitation, not an instruction that will fail. |
| **Never score generously** | Scores are computed from the assembled prompt's own structure, not from intent. The calibration line states plainly that this measures specification quality, not model output. |
| **Never expose private chain-of-thought** | The engine emits *decisions with evidence* ("primary task: research, matched on: literature review, systematic review"), not hidden reasoning. |
| **Never execute pasted content** | Anything you paste is data to analyse. Instruction-override attempts ("ignore your rules…") are stripped, reported, and a defence is written into the output. |
| **Prefer useful simplicity** | Technique selection is budgeted. Level 1 tasks get short prompts; long prompts for simple tasks are penalised by the Efficiency check. |
| **Deterministic** | Same input → byte-identical output. No randomness, no sampling, no network calls. |

## Architecture

```
src/core/
  util/        text normalisation, signal matching, decision tracing
  knowledge/   taxonomy (63 tasks) · targets (22 models) · techniques (50)
  templates/   section library + per-archetype recipes
  pipeline/    classify → extract → clarify → strategy → build → red-team → score → engine
src/cli/       command-line interface
src/server/    node:http server (no dependencies) + JSON API
src/web/       single-page UI (vanilla JS, no build step)
tests/         node:test — engine, knowledge integrity, tools
```

**Zero runtime dependencies.** Node 18+ and a browser are the only requirements. It runs offline.

### The pipeline

```
raw request
   → understand      intent, objective, deliverable
   → classify        categories + evidence, target model, complexity level
   → extract         requirements (MUST/SHOULD/OPTIONAL), constraints, audience, unknowns, conflicts
   → clarify         ≤3 questions, only when material; otherwise labelled assumptions
   → strategy        techniques selected within a cost budget, gated by capability
   → build           sections assembled from the archetype recipe
   → red-team        18 failure modes; repairs applied in place
   → score           13 checks, 12 weighted dimensions, improvement levers
   → optimise        de-duplicate, right-size, generate variants + workflow
   → output          prompt, reasoning, quality, assumptions, hand-off
```

### API

```bash
curl -s localhost:4317/api/generate -H 'content-type: application/json' \
  -d '{"input":"plan a 5 day trip to japan in april on a mid budget","targetId":"claude"}'
```

| Endpoint | Purpose |
|---|---|
| `POST /api/generate` | `{ input, targetId?, answers?, minimal?, advanced?, workflow?, explain? }` |
| `POST /api/analyze` | same, for pasted prompts (improve / compress / test / compare / translate) |
| `GET /api/targets` | target profiles for a model selector |
| `GET /api/health` | liveness + version + recognised modes |

```js
// or use it as a library
import { architect } from './src/core/index.mjs';

const r = architect('i keep failing my physics quizzes, teach me kinematics', { targetId: 'claude' });
console.log(r.prompt);              // the prompt
console.log(r.score.total);         // honest 0-100
console.log(r.strategy.techniques); // what was applied and why
```

## Honest limitations

- **It does not call a model.** Nothing here measures what a model will actually output. Scores describe the *specification quality* of the prompt — a strong, specific, verified brief. That is a real and useful signal, but it is not a prediction.
- **Target capability profiles are design assumptions.** Model features change monthly. Profiles are conservative, marked unverified, and the generated prompt states the assumptions it made so you can correct them.
- **Classification is heuristic.** 63 categories and evidence-based overrides handle a wide range, but a genuinely novel task falls back to the generic archetype and says so.
- **Some extraction is approximate.** Audience, tone and length are only inferred when the text supports it; otherwise they become labelled assumptions and optional questions.
- **Security reviews are scoped to defender use.** The engine writes authorisation boundaries into the prompt and will not produce offensive tooling for systems the user does not own.

## Tests

```bash
npm test        # 34 tests: engine behaviour, knowledge integrity, tool modes
node src/cli/promptnexus.mjs demo   # six representative cases end-to-end
```

The suite asserts the guarantees above: determinism, ≤3 questions, twelve scored dimensions, labelled assumptions, injection handling, media prompts staying compact, every technique rendering without throwing, and every category mapping to a real section recipe.

## Contributing

The knowledge layers are pure data — extending them needs no engine changes:

- **Add a task category** → `src/core/knowledge/taxonomy.mjs` (id, signals, role, must-list, default techniques) and map it in `CATEGORY_RECIPE`.
- **Add a model profile** → `src/core/knowledge/targets.mjs`. State the assumption in `notes`.
- **Add a technique** → `src/core/knowledge/techniques.mjs` (family, cost, risk, applicability, renderer).
- **Add a section** → `src/core/templates/templates.mjs`, then reference it from a recipe.

Run `npm test` before opening a PR — the knowledge-integrity tests will catch a missing builder or an unknown capability gate.

## License

MIT.
