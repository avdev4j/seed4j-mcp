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

## Known gaps (tracked in the roadmap)

- **No retries** — transient 5xx / network blips still fail the whole tool call (#2).
- **Timeout is not yet env-configurable** — the 30 s default is hardcoded; `SEED4J_TIMEOUT_MS` lands with #3.
- **Raw error bodies** — long stack traces and HTML error pages from seed4j flow through unchanged (#4 will summarise and switch to `isError: true` results).
