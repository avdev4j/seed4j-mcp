# Develop

## Requirements

- Node.js 20+
- A running seed4j instance reachable over HTTP (default `http://localhost:1339`)

## Setup

```bash
git clone https://github.com/avdev4j/seed4j-mcp.git
cd seed4j-mcp
npm install
```

## Run from source

```bash
npm run dev                         # run from sources via tsx (no build step)
npm run build && npm start          # compile to dist/ and run the built entrypoint
npm run typecheck                   # tsc --noEmit
```

## Lint & format

ESLint (with `typescript-eslint`) and Prettier are wired up. Both are gated in CI.

```bash
npm run lint                        # ESLint: fail on any error
npm run lint:fix                    # ESLint with --fix
npm run format                      # Prettier: write all files
npm run format:check                # Prettier: fail on any unformatted file
```

Config lives in [`eslint.config.js`](../eslint.config.js) (flat config), [`.prettierrc.json`](../.prettierrc.json), and [`.prettierignore`](../.prettierignore). Prettier owns whitespace; ESLint focuses on semantics. `eslint-config-prettier` is the bridge — no rule conflicts.

Override `SEED4J_BASE_URL` to point at a non-default seed4j instance:

```bash
SEED4J_BASE_URL=http://localhost:7471 npm run dev
```

See [configuration.md](configuration.md) for the full list of environment variables.

## Tests

```bash
npm test                            # all tests, single run
npm run test:watch                  # watch mode
npx vitest run tests/client.test.ts # one file
npx vitest run -t "applyModules"    # tests matching a name
```

Two test layers under [tests/](../tests/):

- **Unit tests** (one file per `src/` module) use a `vi.fn()` fetcher or a mock client. Fast, exhaustive, and lock in the public contract of each module.
- **Integration tests** live in [tests/integration/](../tests/integration/). Each suite boots a real [`node:http`](https://nodejs.org/api/http.html) server on an ephemeral port via [`tests/integration/server.ts`](../tests/integration/server.ts), and exercises `Seed4jClient` with the **global `fetch`** — so URL construction, JSON body framing, the `Authorization` header on the wire, retry against real sockets, and `AbortController`-driven timeouts all run end-to-end. Fixtures used by integration tests live in [tests/fixtures/](../tests/fixtures/) — small, hand-trimmed JSON payloads that match seed4j's shapes.

Both layers run under `npm test`. No separate command needed.

The integration helper binds `127.0.0.1` on an ephemeral port. In restricted sandboxes where local socket binding is blocked, setup fails immediately with the underlying listen error instead of timing out every test.

## CI gates

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs on every push to `main` and every pull request, in this order: `npm ci → lint → format:check → typecheck → build → test`. A PR with any failure is blocked.

## Project layout

See [overview.md](overview.md) for the four-layer architecture (entrypoint → server → tools → client). Adding a new tool is a two-step process documented in the project [CLAUDE.md](../CLAUDE.md).

## STDIO caveat

MCP framing lives on stdout, so **nothing else may write to stdout**. The entrypoint routes startup errors to stderr; do not add `console.log` or other stdout writes from tool handlers, or the MCP stream will be corrupted and the client will hang. Use `console.error` (stderr) or write to a file.
