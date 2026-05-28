# Configuration

The server reads its configuration from environment variables at startup ([src/index.ts](../src/index.ts)). No config file is supported.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `SEED4J_BASE_URL` | `http://localhost:1339` | Base URL of the seed4j HTTP API. All tool calls hit `${SEED4J_BASE_URL}/api/…`. |

That's the full list as of today.

## Planned configuration (not implemented yet)

These come from [ROADMAP.md](ROADMAP.md) and are listed here so operators can plan ahead — none of them are read by the current code.

| Variable | Roadmap | Purpose |
| --- | --- | --- |
| `SEED4J_TIMEOUT_MS` | #1, #3 | Per-request timeout for HTTP calls into seed4j. |
| `SEED4J_RETRIES` | #2, #3 | Number of retries on transient GET failures. |
| `SEED4J_AUTH_HEADER` / bearer | #3 | Auth header forwarded to seed4j. |
| `SEED4J_LOG_FILE` | #13 | Path for file-based debug logging (stdout is off-limits). |

## Launching the server

```bash
# From a published install
SEED4J_BASE_URL=http://localhost:1339 npx seed4j-mcp

# From sources during development
SEED4J_BASE_URL=http://localhost:1339 npm run dev
```

A seed4j instance must be reachable at `SEED4J_BASE_URL` for any tool call to succeed.
