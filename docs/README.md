# Documentation

Everything about how this system is designed, why it is shaped that way, and how
to operate it.

---

## Start here

| If you want to… | Read |
|---|---|
| Understand the product | [`../README.md`](../README.md) |
| Understand the engine's design | [`architecture.md`](./architecture.md) |
| Know what it does and does not do | [`system-design.md`](./system-design.md) |
| See how the screens fit together | [`app-flow.md`](./app-flow.md) |
| Know why a decision was made | [`decisions/`](./decisions/) |

## Design and architecture

| Document | Contents |
|---|---|
| [`system-design.md`](./system-design.md) | Problem, users, workflows, requirements, and an explicit out-of-scope list |
| [`architecture.md`](./architecture.md) | Pipeline stages, data contracts, extension points |
| [`app-flow.md`](./app-flow.md) | Screens, navigation, the six core journeys, edge cases |
| [`design-brief.md`](./design-brief.md) | Colour, type, spacing, components, motion, the ambient field |
| [`implementation-plan.md`](./implementation-plan.md) | Build order, what shipped, what is deferred and why, risks |
| [`decisions/`](./decisions/) | Architecture decision records, 0001–0003 |

## Engineering

| Document | Contents |
|---|---|
| [`api-conventions.md`](./api-conventions.md) | Endpoints, the canonical error shape, status codes, the result contract |
| [`testing.md`](./testing.md) | Test strategy, what is covered, what is deliberately not, CI gates |
| [`permissions.md`](./permissions.md) | The access model — and the rules to follow if accounts are ever added |

## Operations

| Document | Contents |
|---|---|
| [`hosting.md`](./hosting.md) | Platform choice, cost at launch / 10× / 100×, region, alternatives |
| [`caching.md`](./caching.md) | What is cached, where, for how long, and what is never cached |
| [`monitoring.md`](./monitoring.md) | What is observed, and an honest list of what is not set up |
| [`security/threat-model.md`](./security/threat-model.md) | Assets, entry points, seven threats, accepted gaps |
| [`runbooks/deploy.md`](./runbooks/deploy.md) | First deploy, verification, rollback, troubleshooting |
| [`runbooks/rollback.md`](./runbooks/rollback.md) | Promote a previous deployment; verify |
| [`runbooks/incident.md`](./runbooks/incident.md) | Declare, stabilise, assess, communicate, review |

## Conventions for these documents

- **Write the decision, not the description.** Code already shows what happens;
  documents should explain why, and what was rejected.
- **Keep the honest sections honest.** "Out of scope", "accepted gaps" and "not set
  up" are the most valuable parts of each document. A threat model with no accepted
  gaps is an advertisement.
- **Update in the same pull request as the change.** A document that lags the code
  is worse than no document, because it is trusted.
- **Prefer tables and short sentences.** These are read by people mid-task.
