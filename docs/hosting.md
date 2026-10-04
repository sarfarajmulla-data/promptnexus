# Hosting

Where this runs, what it costs, and what would need to change at 10×.

---

## Platform: Vercel

Chosen because the application is exactly the shape Vercel is good at: a static
front end, a handful of stateless functions, no database, no background jobs, no
long-running processes.

| Component | Provider | Configuration |
|---|---|---|
| Static UI | Vercel CDN | Output directory `public/`, no framework, no bundler |
| Engine (browser fallback) | Vercel CDN | Generated at build time into `public/engine/`, cached immutably |
| API | Vercel Functions | `api/*.js`, 1024 MB, 15 s timeout |
| Build | Vercel build | `npm run build` — asserts engine purity, then copies it |
| Database | **none** | Nothing is persisted server-side |
| Storage | **none** | The prompt library lives in the visitor's browser |
| Background jobs | **none** | Every request is a pure computation |
| Email | **none** | There is no account system and nothing to send |

## Cost at launch

| Item | Free tier | Expected usage | Cost |
|---|---|---|---|
| Static hosting + bandwidth | 100 GB / month | ~200 KB per visitor; the engine is cached immutably | ₹0 |
| Function invocations | 100 GB-hours / month | Each call is well under 1 s of compute | ₹0 |
| Function executions | 1 M / month | — | ₹0 |

**Total at launch: ₹0.** With no provider configured there is no per-request cost
of any kind — no model calls are made.

## Cost at 10× and 100×

| Scale | Requests / month | Bandwidth | Estimated cost |
|---|---|---|---|
| Launch | ~10 K | ~2 GB | ₹0 (free tier) |
| 10× | ~100 K | ~20 GB | ₹0 (still inside free tier) |
| 100× | ~1 M | ~200 GB | Paid tier, ~$20/month, driven by bandwidth rather than compute |

**What breaks first:** bandwidth, not compute. The engine is served once per
visitor and cached immutably, so the marginal cost per user is small; the marginal
cost per *first* user is the whole engine.

**What to do at 100×:** split the engine so the browser fallback loads only the
modules a given session uses (the ES-module graph already allows this — the UI
imports `index.mjs` only in the fallback path), and raise the cache TTL on
`/engine/*` from one year to immutable-forever with content-hashed filenames.

## Region and data residency

Vercel serves from edge locations automatically. There is no database, so there is
nothing to place in a jurisdiction. The only data that leaves a user's device is
the text of a request — already its own content, sent to compute a response, and
never logged or stored by the application.

## Environment variables

**None are required.** The application is fully functional with an empty
environment. Optional variables (provider refinement) are documented in
[`.env.example`](../.env.example); all are server-side and none reach the browser.

## Alternatives considered

| Option | Why not |
|---|---|
| Static-only host (GitHub Pages, Netlify static) | The API must exist for programmatic use, and a static host cannot run the functions |
| A long-running Node server (Railway, Render, Fly) | There is no state and no background work — a persistent process would be paid for and idle |
| A bundler + framework (Next.js on Vercel) | Adds a build toolchain and dependencies for a page that needs neither; see [decision 0001](./decisions/0001-zero-dependencies.md) |
| Self-hosted | Meaningless at this scale: the app is a static directory and four functions |

## Operational notes

- **Deploys:** `docs/runbooks/deploy.md`.
- **Rollback:** promote a previous deployment — instant, because there is no
  migration step and no state to reconcile.
- **Monitoring:** `/api/health` runs a real engine self-check, so it detects a
  broken pipeline rather than merely a live process. See [`monitoring.md`](./monitoring.md).
- **Billing alerts:** set them on the Vercel account even on the free tier — the
  only plausible surprise is bandwidth.
