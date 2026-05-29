# Configuration

The server reads its configuration from environment variables at startup ([src/index.ts](../src/index.ts) → [src/config.ts](../src/config.ts)). No config file is supported.

Invalid values **never** crash the server. Each bad value emits a single warning line on stderr (e.g. `seed4j-mcp: ignoring SEED4J_TIMEOUT_MS="abc": expected a positive integer (using default 30000)`) and the corresponding default applies. Stdout stays clean (STDIO golden rule).

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `SEED4J_BASE_URL` | `http://localhost:1339` | Base URL of the seed4j HTTP API. All tool calls hit `${SEED4J_BASE_URL}/api/…`. |
| `SEED4J_TIMEOUT_MS` | `30000` | Per-request timeout in milliseconds. Must be a positive integer. Applies to every outbound HTTP call (GETs and the apply-patch POST). See [errors.md](errors.md#timeouterror-request-exceeded-the-per-call-timeout). |
| `SEED4J_RETRIES` | `2` | Retry budget for idempotent GETs on `TimeoutError`, network errors, and HTTP 5xx. Must be a non-negative integer (0 disables retries). HTTP 4xx and the apply-patch POST are never retried. See [errors.md](errors.md#retries-on-transient-get-failures). |
| `SEED4J_CACHE_TTL_MS` | `3600000` (1 hour) | TTL for the in-process catalogue cache covering `/api/modules`, `/api/modules-landscape`, and `/api/presets`. Must be a non-negative integer; set to `0` to disable caching (useful when iterating on seed4j itself). Errors are never cached. |
| `SEED4J_AUTH_HEADER` | unset | Full `Authorization` header value sent on every outbound request, e.g. `Bearer abc.def`, `Basic dXNlcjpwYXNz`. Use this for any scheme other than bearer. |
| `SEED4J_BEARER_TOKEN` | unset | Convenience shortcut: the server sends `Authorization: Bearer <value>`. Ignored if `SEED4J_AUTH_HEADER` is also set (a warning is emitted on stderr). |
| `SEED4J_LOG_FILE` | unset | Path to a writable JSONL log file. When set, the server appends one JSON line per outbound HTTP request, response, retry, cache hit/populate, timeout, and error. When unset (default), the logger is a frozen no-op singleton — zero overhead. Stdout is never written to (STDIO golden rule). See [logging.md](logging.md). |

## Launching the server

```bash
# Local default
npx -y seed4j-mcp

# Remote / non-default port + bearer auth + longer timeout
SEED4J_BASE_URL=https://seed4j.example.com \
SEED4J_TIMEOUT_MS=60000 \
SEED4J_BEARER_TOKEN=eyJhbGciOi... \
npx -y seed4j-mcp

# From sources during development
SEED4J_BASE_URL=http://localhost:7471 npm run dev
```

A seed4j instance must be reachable at `SEED4J_BASE_URL` for any tool call to succeed.

When wiring the server into an MCP client (Claude Code, Claude Desktop, Cursor, …), pass these env vars through the client's MCP server config. See [clients.md](clients.md) for examples.
