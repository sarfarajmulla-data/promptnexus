# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/);
versioning follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **The CLI could not start at all.** `src/cli/promptnexus.mjs` imported `start`
  from the server module, which exported nothing, so every invocation — including
  the published `bin` entry — died with a module error. The server now exports
  `createApp()` and `start()`, binds a port only when run directly, and the CLI
  has a test suite. Empty-input commands also exited `0` on misuse; they now
  report the problem and exit `1`.
- **Two quadratic regular expressions** in the pipeline (blank-line prompt
  splitting and the robustness scorer). A pasted document with thousands of blank
  lines hung the process indefinitely; the same input is now linear — 200 000
  newlines process in ~1.5 ms.
- **A translate-mode warning was silently discarded.** The object literal that
  built the response contained two `warnings` keys, and the second overwrote the
  first — so the "this prompt still lacks…" gap list never reached the user.
- **A quoted title broke XML output.** `xmlEscape` escaped `<`, `>` and `&` but
  not quotes, so a prompt title containing `"` produced malformed XML.
- **The secret scanner judged its allowlist against the whole line**, which meant
  a genuine key sharing a line with the word `placeholder` or `example.com` was
  silently allowed through. The allowlist now tests only the matched value.

### Added
- Provider routing contract (design): a server-side router that selects a model
  based on task type, quality requirement, cost and capability, with graceful
  fallback to No-AI mode. Keys remain server-side; the engine decides what
  intelligence is needed, the router decides which model supplies it.

## [1.0.0] — 2026-10-04

First complete release. The engine, the API, the CLI and the Beta UI are all
functional; the engine is deterministic and dependency-free.

### Added

**Engine**
- Five-stage pipeline: understand → classify → strategy → construct → verify
- 63 task categories with weighted keyword/phrase/regex signals and evidence
- 22 model/tool profiles with honest, unverified capability flags
- ~50 technique cards, cost-budgeted and capability-gated
- 23 archetype recipes over a shared section library; dedicated media-prompt shape
- Complexity assessment on a 1–5 scale with per-category floors
- Multi-prompt workflows and agent specifications for level 4–5 requests
- Twelve-dimension quality score with banding, weaknesses and improvement levers
- Adversarial review: 18 failure modes checked, reported, and repaired in place
- Prompt-injection defence: pasted content is treated as data, reported, never obeyed
- Line-level provenance: every line in a generated prompt traces to its source
- Source classification: known / user-provided / inferred / assumed / needs verification

**Interfaces**
- CLI with eleven commands and JSON output
- HTTP API: `POST /api/generate`, `POST /api/analyze`, `GET /api/targets`, `GET /api/health`
- Beta UI: create, optimize, test, compare, templates, library, settings
- Service abstraction with a real offline fallback — the engine runs in the browser
- Ambient background field on a 2D canvas, with reduced-motion and low-power fallbacks

**Operations**
- Vercel configuration: static output, serverless functions, security headers, SPA rewrites
- Build step that copies the engine to `public/engine/` and fails if it stops being browser-safe
- 37 tests: engine behaviour, knowledge integrity, traceability, tool modes

### Design decisions worth recording

- **No LLM in the prompt-generation path.** A rule engine can guarantee that it
  never invents user facts and never overstates model capabilities. A model
  cannot make that promise, so the core stays deterministic by design.
- **Zero dependencies.** The engine must run in a terminal, a lambda and a
  browser tab without a supply chain.
- **Honesty over impressiveness.** Unknowns become labelled assumptions, scores
  have a calibration footnote, and unverified capabilities are marked as such.

[Unreleased]: https://github.com/sarfarajmulla-data/promptnexus/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/sarfarajmulla-data/promptnexus/releases/tag/v1.0.0
