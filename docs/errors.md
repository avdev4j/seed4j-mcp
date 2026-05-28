# Errors

## How failures surface today

Tool handlers do **not** catch errors from `Seed4jClient`. When a call fails, the underlying `Promise` rejection propagates into the MCP SDK and is delivered to the client as a JSON-RPC error response. Two sources of failure exist:

### `HttpError` (non-2xx from seed4j)

`Seed4jClient.getText` / `postJson` throw an [`HttpError`](../src/client.ts) when seed4j responds with a non-2xx status:

```
HttpError {
  status: number,
  body: string,   // raw response body
  url: string,    // the absolute URL that was hit
  message: `HTTP ${status} for ${url}: ${body}`,
}
```

The `message` is what the agent ultimately sees. The whole response body is included verbatim, which is sometimes very long.

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

- **No timeouts** — a hung seed4j stalls the MCP client until the underlying socket gives up (#1).
- **No retries** — transient 5xx / network blips fail the whole tool call (#2).
- **Raw error bodies** — long stack traces and HTML error pages from seed4j flow through unchanged (#4 will summarise and switch to `isError: true` results).
