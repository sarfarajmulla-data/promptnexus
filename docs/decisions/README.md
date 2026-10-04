# Decision log

Architecture decisions, in the order they were made. One file per decision:
context, decision, consequences, alternatives considered.

| # | Decision | Status |
|---|---|---|
| [0001](./0001-zero-dependencies.md) | Zero runtime dependencies | Accepted |
| [0002](./0002-browser-runs-the-engine.md) | The browser runs the engine, not just the API | Accepted |
| [0003](./0003-no-llm-in-the-core.md) | No LLM in the prompt-generation path | Accepted |

## Why keep this log

The interesting decisions here are the ones that say *no*. Reading the code tells
you what the system does; it does not tell you why a model was deliberately left
out of the pipeline, or why a bundler was rejected. That context is lost the
moment it stops being written down — and it is exactly the context needed before
someone proposes adding an LLM to the core, which is the most likely future
"improvement" and the one that would quietly dissolve the product's guarantees.

## Adding a decision

Copy the format of an existing entry. Number sequentially. Set the status to
`Proposed`, `Accepted`, `Superseded by NNNN`, or `Rejected`. Record the
alternatives honestly, including the one you almost chose — a decision log that
only lists straw men is worse than none.

When a decision is superseded, do not delete it. Mark the status and link to the
replacement.
