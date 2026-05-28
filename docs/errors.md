# Errors

## How failures surface today

Tool handlers do **not** catch errors from `Seed4jClient`. When a call fails, the underlying `Promise` rejection propagates into the MCP SDK and is delivered to the client as a JSON-RPC error response. Three sources of failure exist:

### `HttpError` (non-2xx from seed4j)

`Seed4jClient` throws an [`HttpError`](../src/client.ts) when seed4j responds with a non-2xx status:

```
HttpError {
  status: number,
  body: string,   // raw response body
  url: string,    // the absolute URL that was hit
  message: `HTTP ${status} for ${url}: ${body}`,
}
```

The `message` is what the agent ultimately sees. The whole response body is included verbatim, which is sometimes very long.

### `TimeoutError` (request exceeded the per-call timeout)

Every outbound `fetch` is wrapped with an `AbortController` armed for `timeoutMs` (default **30 s**). When the timer fires, the request is aborted and the call rejects with a [`TimeoutError`](../src/client.ts):

```
TimeoutError {
  url: string,        // the absolute URL that was hit
  method: string,     // "GET" | "POST"
  timeoutMs: number,  // the configured timeout
  message: `seed4j request timed out after ${timeoutMs}ms: ${method} ${url}`,
}
```

A hung or unreachable seed4j therefore fails fast with an actionable error instead of stalling the MCP client. The timeout applies to all HTTP calls (catalogue GETs, presets GETs, apply-patch POSTs, project status GET). The configurable env var (`SEED4J_TIMEOUT_MS`) lands in roadmap #3 — today the default is in effect for the production entrypoint.

### Validation / programming errors

Some client methods throw plain `Error`s before any HTTP call:

| Method | Throws when |
| --- | --- |
| `getPresetDetails` | preset name is blank or no preset matches. |
| `applyModules` | the step list is empty. |
| `applyPreset` | the preset resolves to zero modules. |
| `getModuleDependencies` | the slug is not found in the landscape. |
| `validateProperties` | (does not throw — returns `{ valid: false, errors }`). |

## Retries on transient GET failures

Read-only GETs (`/api/modules`, `/api/modules/{slug}`, `/api/presets`, `/api/modules-landscape`, `/api/projects?path=…`) are automatically retried inside `Seed4jClient` when the failure looks transient:

- **Retryable:** `TimeoutError`, HTTP 5xx (`HttpError` with `status >= 500`), and other thrown errors (e.g. network errors from `fetch` itself).
- **Not retryable:** HTTP 4xx (`HttpError` with `status < 500`) — these are deterministic (auth, bad slug, malformed query).
- **Not retried at all:** POSTs to `apply-patch`. Re-running a half-applied module could leave the project in an inconsistent state — that decision belongs to the agent, not the transport layer.

Backoff is capped exponential: `min(retryBaseDelayMs * 2^attempt, retryMaxDelayMs)`. Defaults are `retries = 2` (so up to 3 attempts), `retryBaseDelayMs = 200`, `retryMaxDelayMs = 2_000`. When all attempts fail, the **last** error propagates unchanged (so callers can still match on `HttpError.status` / `TimeoutError`).

Env-driven configuration (`SEED4J_RETRIES`, plus the existing `SEED4J_TIMEOUT_MS`) is tracked as roadmap #3.

## Known gaps (tracked in the roadmap)

- **Timeout / retries are not yet env-configurable** — defaults are hardcoded; `SEED4J_TIMEOUT_MS` and `SEED4J_RETRIES` land with #3.
- **Raw error bodies** — long stack traces and HTML error pages from seed4j flow through unchanged (#4 will summarise and switch to `isError: true` results).
