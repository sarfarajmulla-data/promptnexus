# 0001 — Zero runtime dependencies

- **Status:** Accepted
- **Date:** 2026-10-04
- **Deciders:** maintainer

## Context

The engine has to run in four environments: a terminal, a serverless function, a
browser tab, and (during development) a local HTTP server. The conventional way
to build a prompt tool is to reach for a web framework, a UI library, a validation
library and a bundler.

Two forces pushed against that.

First, the product claim is *offline and inspectable*. Every guarantee it makes —
never invent facts, never overstate a model, never hide reasoning — depends on a
human being able to read the code that produces the output. A dependency tree of
hundreds of packages makes that impossible to verify.

Second, a prompt tool that requires `npm install` to run has a supply-chain
surface with no relationship to its purpose. Prompt engineering logic has no
business pulling in a transitive dependency on a date library.

## Decision

The project has **no runtime dependencies, and no dev dependencies**. Nothing is
installed; `npm test` runs on a bare Node 18+.

This is enforced, not merely intended:

- `package.json` declares no `dependencies` or `devDependencies`.
- CI fails the build if either appears.
- `.github/dependabot.yml` still watches the npm ecosystem, so an accidental
  introduction is caught quickly.

## Consequences

**Good.** Clone-and-run works with no install step. The engine runs unmodified in
four environments. Every line of behaviour is auditable. There is no supply chain
to compromise, no lockfile to update, and no version-drift class of bug.

**Bad.** There is no framework, so routing, state management and components are
hand-written (`public/js/`, ~1,400 lines). The CSS is a hand-written design
system. HTML templating is string interpolation, which means escaping discipline
is manual — `esc()` is used everywhere user text enters the DOM.

**Mitigation.** The hand-written surface is small and covered by tests. The
UI has no build step, so what is served is exactly what is in the repository.

## Alternatives considered

- **Next.js + React + Tailwind.** The default choice, and rejected: it makes the
  "inspectable offline tool" claim false, and none of its features are needed for
  a single-page app with four API routes.
- **Vite + a small UI library.** Better than Next, still a build step and a
  dependency tree for a page that needs neither.
- **Dependencies for the engine only (e.g. a validation library).** Rejected: the
  validation here is a few hundred lines of explicit rules, which is both smaller
  and more honest than a library that would obscure what is actually checked.

## Revisit if

The UI exceeds roughly 5,000 lines of hand-written JavaScript, or a new surface
(for example, a native mobile client) makes shared components genuinely valuable.
Even then, the **engine** must remain dependency-free — that is the part the
guarantees rest on.
