# 0002 — The browser runs the engine, not just the API

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainer

## Context

The application needs serverless API routes for programmatic access. The obvious
split is: UI in the browser, engine on the server, UI calls the API.

That split has two costs. The tool stops working when the network is unavailable —
which undercuts "works offline" — and the deployment becomes a hard dependency for
something that is, at its core, arithmetic over strings and tables.

## Decision

`src/core/**` must remain **browser-safe**: no `node:` imports, no Node globals,
no filesystem, no network, no randomness, no clock.

`npm run build` copies it verbatim to `public/engine/`, and the build **fails** if
any `node:` import or `require()` call appears. The API routes import the same
modules from `src/core/`. One implementation, two entry points.

At runtime the UI probes `/api/health` once. On success it uses the API. On
failure it dynamically imports `/engine/index.mjs` and computes the result
locally. The header chip always shows which path is active.

## Consequences

**Good.** Works with no network and no server. The API is an optimisation, not a
dependency. Identical behaviour on both paths, because it is identical code. A
sandboxed or offline preview still demonstrates the real product rather than an
error state.

**Bad.** The engine (~360 KB of source, 20 modules) is shipped to the browser.
Classification cost is paid client-side in the fallback path.

**Mitigations.**

- The generated `public/engine/` is gitignored; it is built at deploy time, so the
  repository stays clean.
- Modules load individually rather than as a bundle, so a cold page does not pay
  for code it never imports.
- The engine is pure computation with no I/O, so its cost is negligible against
  the network round-trip it replaces.

## Alternatives considered

- **API only.** Rejected: a prompt tool that cannot run without a server is a
  weaker product, and the "no key, no account, runs anywhere" claim would be false.
- **Bundle the engine with a bundler.** Rejected: introduces a build toolchain and
  a dependency for a directory copy (see [0001](./0001-zero-dependencies.md)).
- **Two implementations (a server one and a client one).** Rejected outright: two
  implementations of a scoring function will diverge, and the divergence would be
  invisible until a user noticed two different scores for one prompt.

## Enforcement

| Check | Where |
|---|---|
| No `node:` imports in `src/core` | `scripts/build-public-engine.mjs`, CI job `engine-purity` |
| Determinism (same input → same output) | CI job `engine-purity` |
| Build output exists | CI job `test` |
| Offline path equality | `tests/` compares engine output to API expectations |

## Revisit if

The engine grows large enough that shipping it to the browser is a real
performance cost — for example, if the knowledge tables exceed a megabyte. The
fallback could then be limited to a subset of the engine while the API stays
authoritative.
