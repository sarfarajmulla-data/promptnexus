# API conventions

The contract every endpoint follows. If code and this document disagree, the
document is wrong — fix it in the same pull request.

---

## Base

| Environment | Base URL |
|---|---|
| Local | `http://localhost:4317/api` |
| Production | `https://<deployment>.vercel.app/api` |

All responses are `application/json; charset=utf-8` with `Cache-Control: no-store`
and `X-Content-Type-Options: nosniff`.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness plus a real engine self-check |
| `GET` | `/api/targets` | Model profiles, task groups, quality and mode options |
| `POST` | `/api/generate` | Situation → optimised prompt |
| `POST` | `/api/analyze` | Tools: `improve`, `expand`, `compress`, `test`, `translate`, `compare`, `score` |

`OPTIONS` is answered with `204` and permissive CORS headers, so the API is usable
from another origin.

## Naming

- Lowercase, no verbs in paths beyond the resource (`/api/generate`, not `/api/createPrompt`).
- JSON bodies: `camelCase`.
- The operation selectors inside `/api/analyze` are short lowercase verbs (`action: "compress"`).
- Booleans are positive (`explain`, not `noExplain`).

## Request rules

1. **Validate at the boundary.** Every handler reads the body, validates it, and
   rejects with a specific message. Nothing invalid reaches the engine.
2. **Bound the input.** Bodies are size-limited (1 MB). Oversized input is refused,
   not truncated silently.
3. **Never trust a field's type.** Non-string values are coerced or ignored;
   unknown keys are dropped rather than forwarded.
4. **Targets are checked against the registry.** An unknown `targetId` is a `400`,
   never a silent fallback.
5. **Pasted content is data.** Text submitted to `/api/analyze` is analysed, never
   executed. Known override attempts are stripped and reported.

## Canonical error shape

Every failure — validation, engine, or unexpected — returns this shape:

```json
{
  "error": "Nothing to work with yet.",
  "hint": "Send { \"input\": \"…\" } describing the situation or prompt.",
  "retryable": false,
  "meta": { "ms": 3, "version": "1.0.0" }
}
```

| Field | Rule |
|---|---|
| `error` | One sentence, written for a person. For `5xx` it is deliberately generic — internals are never echoed |
| `hint` | What to do next. Omitted when there is nothing useful to say |
| `retryable` | `true` only for `5xx`; the client may offer "Try again" |
| `meta.ms` | Server-side duration, for support conversations |
| `meta.version` | Engine version, so a report can be pinned to a build |

**Never returned:** stack traces, file paths, dependency names, environment values,
model names, or any internal identifier. A test asserts this.

## Status codes

| Code | When |
|---|---|
| `200` | Success |
| `204` | `OPTIONS` preflight |
| `400` | Malformed JSON, missing input, unknown action or target |
| `405` | Wrong method for the endpoint |
| `413` | Body over the size limit |
| `422` | Input is valid but the engine cannot produce a result |
| `500` | Unexpected failure. Generic message, `retryable: true` |

## Response envelopes

Every successful response includes `meta`:

```json
{ "meta": { "ms": 12, "version": "1.0.0", "engine": "deterministic-local" } }
```

`engine` is either `deterministic-local` (the engine computed it) or the provider
name when refinement is configured. A client can always tell which path ran.

### `/api/generate` — the result contract

| Field | Type | Notes |
|---|---|---|
| `goal` | string | The understood objective, in one sentence |
| `prompt` | string | The deliverable, ready to copy |
| `score` | object | `{ total, band, verdict, calibration, dimensions[], weaknesses[], levers[] }` |
| `strategy` | object | `{ summary, rationale, complexity, categories[], techniques[], sections }` |
| `target` | object | `{ id, label, verified, style }` — `verified: false` means assumed |
| `provenance` | array | `[{ section, lines, sectionSources, trace: [{ text, source, detail }] }]` |
| `assumptions` | array | `[{ field, assumption }]` — labelled, never invented |
| `openQuestions` | array | Max three, each with `options` and a `default` |
| `failureModes` | array | `[{ id, label, severity, risk, mitigation, status }]` |
| `injectionDefense` | object | `{ detected, vectors[], contained, note }` — what was stripped and what was kept |
| `warnings` | array | Human-readable cautions. Empty is the normal case |
| `limitations` | array | What this prompt cannot do. Always present |
| `variants`, `workflow`, `handoff` | object/array | Present when the request warrants them |
| `engine`, `version`, `mode` | string | Provenance of the response itself |
| `explanation` | array | Only when `explain: true` |

The response is **flat** — there is no `result` wrapper. A client reads `data.prompt`,
not `data.result.prompt`. `meta` carries timing and environment detail and is safe to ignore.

Additive fields are not a breaking change. Removing or renaming one is.

## Versioning

The API is unversioned while it is pre-1.0 in adoption. Breaking changes will be
announced in [`CHANGELOG.md`](../CHANGELOG.md) and, if the API has consumers,
introduced under `/api/v2` with the previous version kept for one release cycle.

## Idempotency

Every endpoint is a pure function of its input: the same request returns the same
response. Nothing is written, so retries are always safe. This is why there is no
idempotency-key mechanism — there is no state to corrupt.
