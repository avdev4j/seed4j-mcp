# Logging

STDIO MCP servers have a hard constraint: anything written to **stdout** corrupts the MCP framing and hangs the client. That makes `console.log` debugging off-limits. To give operators a safe escape hatch, the server can append a structured JSON log to a file — gated entirely behind one env var.

## Enabling

Set `SEED4J_LOG_FILE` to a writable absolute path:

```bash
SEED4J_LOG_FILE=/tmp/seed4j-mcp.log npx -y seed4j-mcp
```

When the var is unset (default), the logger is a frozen **no-op singleton** — zero allocations per log call, zero file system traffic. Setting it to a blank string is treated as unset.

## Format

One JSON object per line (JSONL). Each entry carries:

| Field | Always present? | Notes |
| --- | --- | --- |
| `timestamp` | yes | ISO 8601 (UTC). |
| `level` | yes | `"debug"` \| `"info"` \| `"warn"`. |
| `event` | yes | Machine-readable tag — see the table below. |
| Per-event fields | event-specific | `method`, `path`, `status`, `latencyMs`, `attempt`, etc. |

## Events

| Event | Level | Fired when | Fields |
| --- | --- | --- | --- |
| `http.request` | info | Every outbound HTTP call (GETs and the apply-patch POST). | `method`, `path` |
| `http.response` | info / warn | Response received. `warn` when non-2xx. | `method`, `path`, `status`, `latencyMs` |
| `http.timeout` | warn | The per-call `AbortController` fires before a response arrives. | `method`, `path`, `timeoutMs` |
| `http.error` | warn | A non-timeout error escapes the fetch (network failure, etc.). | `method`, `path`, `error` |
| `http.retry` | info | A retry is about to fire (after backoff). | `attempt`, `delayMs`, `lastError` |
| `cache.hit` | debug | Catalogue cache served a body without a roundtrip. | `path` |
| `cache.populate` | debug | A fresh fetch was stored in the catalogue cache. | `path` |

The `path` field is **relative** — just `/api/modules`, not `${SEED4J_BASE_URL}/api/modules` — to keep lines short and base-URL secrets (rare, but possible) out of the file.

## What is *not* logged

- **Authorization headers.** The logger never echoes request headers. The `Authorization` value set via `SEED4J_AUTH_HEADER` / `SEED4J_BEARER_TOKEN` is never written to disk.
- **Request bodies.** Apply-patch POST bodies can contain user `properties` (potentially sensitive) and module slugs — we don't log them. The path identifies which module.
- **Response bodies.** Not logged in normal operation. The structured tool errors (#4) already truncate body excerpts to ~500 chars and ship them to the **client**, not the log file.
- **Tool invocations.** The tool layer doesn't log — the client does. Every tool call surfaces as one or more `http.*` events.

## Example session

```jsonl
{"timestamp":"2026-05-29T11:02:01.000Z","level":"info","event":"http.request","method":"GET","path":"/api/modules"}
{"timestamp":"2026-05-29T11:02:01.047Z","level":"info","event":"http.response","method":"GET","path":"/api/modules","status":200,"latencyMs":47}
{"timestamp":"2026-05-29T11:02:01.048Z","level":"debug","event":"cache.populate","path":"/api/modules"}
{"timestamp":"2026-05-29T11:02:05.001Z","level":"debug","event":"cache.hit","path":"/api/modules"}
{"timestamp":"2026-05-29T11:02:10.000Z","level":"info","event":"http.request","method":"POST","path":"/api/modules/maven-java/apply-patch"}
{"timestamp":"2026-05-29T11:02:40.001Z","level":"warn","event":"http.timeout","method":"POST","path":"/api/modules/maven-java/apply-patch","timeoutMs":30000}
```

Useful filters:

```bash
# All errors and timeouts
jq 'select(.level=="warn")' /tmp/seed4j-mcp.log

# Average latency per endpoint
jq -r 'select(.event=="http.response") | "\(.path) \(.latencyMs)"' /tmp/seed4j-mcp.log

# Retry storms
jq 'select(.event=="http.retry")' /tmp/seed4j-mcp.log
```

## Failure modes

- **Path unwritable / parent dir missing.** The log file open is best-effort; failures are reported as a single stderr line (`seed4j-mcp: log file … write error: …`) when the stream emits an `error` event. The server keeps running. Logs for that session are lost.
- **Disk full.** Stream-level errors are reported on stderr the same way; the server keeps running.
- **Concurrent runs writing the same file.** The append flag (`{ flags: "a" }`) keeps lines from being truncated; interleaving is fine because each line is independent JSON.

## Log rotation

Not built in. Use `logrotate` / `cron` to truncate or roll the file periodically. Since each line is independent JSON, mid-rotation interleaving is harmless.

## Disabling

Unset the env var. The logger reverts to the no-op singleton immediately on the next start; no code paths emit anything.
