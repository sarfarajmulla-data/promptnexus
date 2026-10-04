# Permissions and access model

This document exists because the question "who can access what?" deserves a
written answer even when the answer is "nothing is shared". It also records the
rules that must be followed if that ever changes.

---

## The model, in one table

| Actor | Can access | Cannot access | Enforced by |
|---|---|---|---|
| Any visitor | The UI, the engine (shipped to the browser), and all four API endpoints | — | Nothing to enforce; all of it is public by design |
| Any visitor | Their own saved prompts, settings and draft | Any other visitor's saved prompts | `localStorage` is origin-scoped and per-browser |
| The provider (if configured) | The text of the request it is asked to refine | Anything else; no key reaches the browser | Server-side env vars only |
| The operator | Deployment configuration, function logs | User prompt libraries — they never leave the browser | Deliberate: no server-side storage exists |
| Other users | — | Each other's data | No shared storage exists |

**There are no accounts, no roles, no organisations, and no server-side user data.**
Consequently there is no object-level authorisation surface: the classic
broken-object-level-authorisation (IDOR) class of vulnerability requires a
resource that belongs to someone — and here, none does.

## What that means for the usual risks

| Risk | Applies? | Why |
|---|---|---|
| IDOR / broken object-level authorisation | **No** | No per-user resources exist on the server |
| Privilege escalation / role confusion | **No** | No roles and no privilege boundary |
| Cross-tenant data leakage | **No** | No tenancy and no shared datastore |
| Cache poisoning across users | **No** | `/api/*` is `no-store`; nothing user-specific is cached at a shared layer |
| Authentication bypass | **No** | There is no authentication — so there is also no login to bypass, and no session to steal |
| **Prompt injection via pasted content** | **Yes** | This is the real attack surface, covered below |
| **Secret exposure** | **Yes** | Provider keys must never reach the client |
| **Denial of service via oversized input** | **Yes** | Bounded at the boundary |

## The rules that hold today

1. **Provider keys are server-side only.** Read from the environment inside the
   function; never returned in a response, never bundled into `public/`.
2. **User text is never logged.** No request body is written to a log, a file, or
   an external service.
3. **Pasted content is data, not instruction.** Override attempts are stripped,
   reported, and never obeyed. See [`security/threat-model.md`](./security/threat-model.md).
4. **Bodies are bounded.** 1 MB limit, refused with a clear message rather than
   buffered unbounded.
5. **Errors are generic.** No internals are echoed to the client.
6. **The library never leaves the device.** Export is a user-initiated download,
   not an upload.

## If accounts or sharing are ever added

The following would become mandatory, in this order:

1. **A resource-ownership check on every read and write**, in one central
   function — never scattered ad-hoc checks.
2. **The check is server-side.** A hidden button is not authorisation.
3. **Return `404`, not `403`,** when a user requests another user's resource by id.
   `403` confirms the resource exists; that is an information leak.
4. **Cross-user tests generated from a permissions matrix**, so the tests cannot
   drift from the documented model.
5. **Sessions revocable**, expiring, and stored in `httpOnly`, `Secure`,
   `SameSite` cookies.
6. **Cache keys must include the user id.** Anything else risks serving one user's
   data to another.
7. **A deletion path that actually deletes** — including backups, with a stated
   retention window.
8. **An audit log** of who did what, if organisations are ever introduced.

An authentication provider would be used rather than hand-rolled password
handling. Nothing in this repository hashes a password, and nothing should.
