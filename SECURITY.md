# Security policy

## Reporting a vulnerability

**Do not open a public issue.** Use GitHub's private reporting:
[Security → Report a vulnerability](https://github.com/sarfarajmulla-data/promptnexus/security/advisories/new).

You can expect an acknowledgement within 72 hours and a decision on severity
within seven days. If the report is valid, we will fix it, credit you unless you
prefer otherwise, and publish an advisory.

## Scope

### In scope

| Area | Why it matters |
|---|---|
| `api/*` request handling | Serverless entry points; input validation and body limits live here |
| Prompt injection via pasted content | Pasted text is analysed; it must never be executed as instruction |
| Secrets reaching the client | Provider keys must never appear in a response or bundle |
| Denial of service via oversized input | Large payloads must be bounded, not buffered unbounded |
| Cross-site scripting in the UI | User text is rendered into the DOM in several views |
| Dependency vulnerabilities | Currently impossible by design — there are no dependencies |

### Out of scope

- **Generated prompt content.** The engine deliberately preserves what the user
  asked for. If a user requests a prompt about a sensitive subject, that is
  intended behaviour, subject to the safety rules below.
- **Score accuracy.** Scores measure specification quality heuristically and the
  UI states this. Disagreeing with a score is a design discussion, not a vulnerability.
- **Unverified model capability flags.** These are explicitly labelled as
  assumptions in both the UI and the API, and are not security claims.
- **Rate limiting in No-AI mode.** Without a provider configured there is nothing
  to bill; abuse protection is the host's responsibility.

## Safety rules enforced in the engine

The engine refuses to produce prompts that facilitate illegal activity, harm to
people, credential theft, malware, fraud, privacy invasion or dangerous activity.
It preserves defensive security work (detection, hardening, incident response)
and attaches uncertainty plus professional-verification caveats to medical,
legal and financial requests.

## Prompt injection

Content pasted for improvement or analysis is treated strictly as data. Known
override patterns are stripped before analysis, their presence is reported to
the user rather than silently dropped, and a "report rather than obey" rule is
written into the generated prompt. This behaviour is covered by tests; a change
that weakens it is a security regression.

## Deployment hardening

- No provider key is ever sent to the browser; all provider calls are server-side.
- Responses set `X-Content-Type-Options: nosniff`, `Referrer-Policy` and a
  restrictive `Permissions-Policy` (see `vercel.json`).
- Request bodies are size-limited and rejected with a clear message.
- Errors return generic messages to clients; internals are never echoed back.
- The application sets no cookies and performs no tracking.
