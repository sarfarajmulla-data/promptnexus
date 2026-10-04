---
description: Security review of the current diff, against PromptNexus-specific risks
---

# Security review

Review the current change as a skeptical security reviewer. You are reviewing
**this repository's actual threat model**, not a generic web app checklist.

## Read first

- `SECURITY.md` — scope, in-scope and out-of-scope items
- `src/core/util/text.mjs` and `src/core/pipeline/extract.mjs` — where untrusted
  text enters the system

## Check, in priority order

1. **Prompt injection.** Does user-pasted content reach analysis as *data*?
   `stripAdversarialContent` must still run and `injectedContent` must still be
   reported. A change that lets pasted text influence engine behaviour is a
   critical regression.
2. **Secret exposure.** Can any provider key reach a response body, an error
   message, a log line, or `public/**`? Keys are server-side only, always.
3. **XSS in the UI.** Every path where user text enters the DOM must go through
   `esc()` in `public/js/ui.js`. Check string interpolation in `public/app.js`,
   especially library rendering and the provenance panel.
4. **Unbounded input.** Are request bodies size-limited? Can a very large input
   cause a long or memory-hungry run in `src/core`?
5. **Error leakage.** Do errors return generic messages, or do they echo stack
   traces, file paths or internals to the client?
6. **Serverless abuse.** Can an endpoint be driven cheaply at scale? Note that
   with no provider configured there is nothing to bill.
7. **Engine purity.** Does the diff add a `node:` import to `src/core/`? That
   breaks the browser path and, more importantly, means engine behaviour now
   depends on the host.

## Report format

For each finding:

```
[severity: critical | high | medium | low]
file:line
What is wrong
Exploit scenario — how an attacker actually uses this
Fix
```

Do not fix anything yet. Report first, ranked by severity. If you find nothing in
a category, say so explicitly — silence is indistinguishable from an oversight.

End with a one-paragraph honest assessment of the change's risk, including
anything you could not verify.
