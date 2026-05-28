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

Unit tests live in [tests/](../tests/) and use a fake `fetch` to exercise [`Seed4jClient`](../src/client.ts) without a real seed4j instance.

## Project layout

See [overview.md](overview.md) for the four-layer architecture (entrypoint → server → tools → client). Adding a new tool is a two-step process documented in the project [CLAUDE.md](../CLAUDE.md).

## STDIO caveat

MCP framing lives on stdout, so **nothing else may write to stdout**. The entrypoint routes startup errors to stderr; do not add `console.log` or other stdout writes from tool handlers, or the MCP stream will be corrupted and the client will hang. Use `console.error` (stderr) or write to a file.
