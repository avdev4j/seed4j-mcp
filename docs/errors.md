# Errors

## How failures surface to the agent

Every tool handler is wrapped in a small `wrap` helper ([src/tools.ts](../src/tools.ts)) that catches thrown errors and returns a **structured MCP error result** instead of letting the rejection bubble up:

```
{
  content: [{ type: "text", text: "<JSON payload>" }],
  isError: true
}
```

MCP clients render `isError: true` results gracefully (typically as an inline error block the agent can read and the user can see), instead of aborting the whole turn the way a raw rejection might. The text inside is a JSON-encoded payload the agent can parse and route on.

### Payload shape

| Field         | Always present? | Notes                                                                                           |
| ------------- | --------------- | ----------------------------------------------------------------------------------------------- |
| `error`       | yes             | `"http"` \| `"timeout"` \| `"client"` \| `"unknown"` — the error kind.                          |
| `tool`        | yes             | The MCP tool name that produced the error, e.g. `"list_modules"`.                               |
| `message`     | yes             | One-line human-readable summary.                                                                |
| `status`      | http only       | The HTTP status code returned by seed4j.                                                        |
| `endpoint`    | http + timeout  | The absolute URL (and method, for timeouts) that was hit.                                       |
| `bodyExcerpt` | http only       | The first 500 chars of the seed4j response body; longer bodies get a `… (N more chars)` suffix. |
| `timeoutMs`   | timeout only    | The configured timeout that fired.                                                              |
| `hint`        | when actionable | A short next-step suggestion (e.g. _"check the tool inputs"_, _"increase SEED4J_TIMEOUT_MS"_).  |

### Per-kind examples

**`http` — seed4j responded with a non-2xx status.** Hint differs by status family.

```json
{
  "error": "http",
  "tool": "apply_module",
  "status": 400,
  "endpoint": "http://localhost:1339/api/modules/maven-java/apply-patch",
  "message": "seed4j responded with HTTP 400",
  "bodyExcerpt": "missing mandatory property: packageName",
  "hint": "check the tool inputs — module slug, properties, or project folder may be wrong"
}
```

```json
{
  "error": "http",
  "tool": "list_modules",
  "status": 503,
  "endpoint": "http://localhost:1339/api/modules",
  "message": "seed4j responded with HTTP 503",
  "bodyExcerpt": "starting up...",
  "hint": "seed4j returned a server error; check the seed4j server logs"
}
```

**`timeout` — the per-request timer fired.**

```json
{
  "error": "timeout",
  "tool": "get_module_details",
  "endpoint": "GET http://localhost:1339/api/modules/maven-java",
  "timeoutMs": 30000,
  "message": "request timed out after 30000ms",
  "hint": "increase SEED4J_TIMEOUT_MS or verify seed4j is reachable at SEED4J_BASE_URL"
}
```

**`client` — a plain `Error` thrown before any HTTP call** (e.g. unknown preset name, empty step list).

```json
{
  "error": "client",
  "tool": "get_preset_details",
  "message": "Preset not found: Foo"
}
```

**`unknown` — a non-`Error` value was thrown.** The original value is stringified into `message`.

## Underlying error classes (inside `Seed4jClient`)

The transport layer still throws typed errors; the wrapping happens at the tool boundary. These types are exported from [src/client.ts](../src/client.ts) and remain useful for tests and for any direct programmatic use.

### `HttpError`

```
HttpError { status, body, url, message: `HTTP ${status} for ${url}: ${body}` }
```

Thrown when seed4j responds with a non-2xx status.

### `TimeoutError`

```
TimeoutError { url, method, timeoutMs, message: `seed4j request timed out after ${timeoutMs}ms: ${method} ${url}` }
```

Thrown when the `AbortController` armed for `timeoutMs` (default 30 s, override via `SEED4J_TIMEOUT_MS`) fires.

### Validation / programming errors

Some client methods throw plain `Error`s before any HTTP call. After wrapping these surface as `error: "client"`:

| Method                  | Throws when                                            |
| ----------------------- | ------------------------------------------------------ |
| `getPresetDetails`      | preset name is blank or no preset matches.             |
| `applyModules`          | the step list is empty.                                |
| `applyPreset`           | the preset resolves to zero modules.                   |
| `getModuleDependencies` | the slug is not found in the landscape.                |
| `validateProperties`    | (does not throw — returns `{ valid: false, errors }`). |

## Retries on transient GET failures

Read-only GETs (`/api/modules`, `/api/modules/{slug}`, `/api/presets`, `/api/modules-landscape`, `/api/projects?path=…`) are automatically retried inside `Seed4jClient` when the failure looks transient:

- **Retryable:** `TimeoutError`, HTTP 5xx (`HttpError` with `status >= 500`), and other thrown errors (e.g. network errors from `fetch` itself).
- **Not retryable:** HTTP 4xx (`HttpError` with `status < 500`) — these are deterministic (auth, bad slug, malformed query).
- **Not retried at all:** POSTs to `apply-patch`. Re-running a half-applied module could leave the project in an inconsistent state — that decision belongs to the agent, not the transport layer.

Backoff is capped exponential: `min(retryBaseDelayMs * 2^attempt, retryMaxDelayMs)`. Defaults are `retries = 2` (so up to 3 attempts, override via `SEED4J_RETRIES`), `retryBaseDelayMs = 200`, `retryMaxDelayMs = 2_000`. When all attempts fail, the **last** error propagates unchanged — and the tool wrapper then turns it into the structured payload above.

## `apply_modules` and `apply_preset` partial failures

These two tools intentionally **aggregate** per-step failures into a successful response (the `failure` and `remaining` fields described in [tools.md](tools.md)), so they typically don't trigger the structured-error wrapper. `wrap` only kicks in for them when something blows up before the apply loop starts (e.g. a 503 on the preset lookup, an empty step list).
