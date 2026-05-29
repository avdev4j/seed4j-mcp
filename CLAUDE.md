# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`seed4j-mcp` is a Model Context Protocol (MCP) server that exposes [seed4j](https://github.com/seed4j) — an open source application generator — to AI agents. The agent drives seed4j through MCP tools instead of a human invoking it directly.

This repo is a **side project of seed4j**, deliberately kept out of the main seed4j repository. Treat seed4j as an external service: this server talks to a running seed4j instance over HTTP, it does not embed seed4j as a library.

Planned improvements are tracked in [docs/ROADMAP.md](docs/ROADMAP.md) as numbered features (1–17). Each entry has a What/Why/Where/Done-when spec so a single item can be picked up and implemented in isolation — consult it before starting new work.

## Tech Stack

- Node.js 20+, TypeScript (ESM, `"type": "module"`).
- `@modelcontextprotocol/sdk` — official MCP TypeScript SDK, used over **STDIO** transport.
- `zod` for tool input schemas (registered via `McpServer.registerTool`).
- Native `fetch` for HTTP calls into seed4j (no third-party HTTP client).
- `vitest` for unit tests.

## Architecture

Three layers, kept intentionally thin:

1. **Tools** — [src/tools.ts](src/tools.ts). `buildTools(client)` returns the list of MCP tool definitions (name, description, zod input shape, handler). Descriptions are the *only* documentation the agent sees; treat them as part of the public API. Handlers return raw JSON strings from seed4j wrapped in `{ content: [{ type: "text", text }] }`, so the agent sees the richest payload — only transform when a tool aggregates or filters the response.
2. **Client** — [src/client.ts](src/client.ts). `Seed4jClient` holds the seed4j base URL and a `fetch` impl, and exposes one method per route. All seed4j HTTP routes live here so the tools layer stays free of transport concerns. The endpoint paths (`/api/modules`, `/api/modules/{slug}`, `/api/modules/{slug}/apply-patch`, `/api/presets`, `/api/projects`, `/api/modules-landscape`) match the JHipster-Lite-style API seed4j inherits — verify against the running seed4j instance before assuming they're stable. Project initialisation is *not* a dedicated endpoint; `createProject` creates the target folder and then applies the `init` module via apply-patch.
3. **Server / entrypoint** — [src/server.ts](src/server.ts) builds an `McpServer` and calls `registerTools` + `registerResources`; [src/index.ts](src/index.ts) wires `Seed4jClient` + `StdioServerTransport` and connects them. Adding a new tool = adding an entry to `buildTools`; adding a new resource = adding an entry to `buildResources` in [src/resources.ts](src/resources.ts); no other wiring is required.

### Tools currently exposed
- `ping_seed4j`
- `list_modules`, `search_modules`, `get_module_details`, `get_module_dependencies`
- `list_presets`, `get_preset_details`
- `validate_properties`, `preview_module`, `get_project_status`
- `create_project`, `apply_module`, `apply_modules`, `apply_preset`

### Resources currently exposed
- `seed4j://catalogue/modules` — full module catalogue (backed by `/api/modules`)
- `seed4j://catalogue/landscape` — module dependency-ranked graph (backed by `/api/modules-landscape`)
- `seed4j://catalogue/presets` — curated preset list (backed by `/api/presets`)

### STDIO transport caveat
The server runs over STDIO. The MCP framing lives on stdout, so **nothing else may write to stdout** — startup errors are routed to stderr in [src/index.ts](src/index.ts). If you add logging from tool handlers, use `console.error` (stderr) or write to a file; any `console.log` will corrupt the MCP stream and the client will hang.

## Build & Run

```bash
# Install deps
npm install

# Build (compile TS → dist/)
npm run build

# Run the compiled server (STDIO — typically launched by an MCP client)
npm start

# Or run from sources without building
npm run dev

# Typecheck only
npm run typecheck

# Run all tests
npm test

# Run a single test file
npx vitest run tests/client.test.ts

# Run tests matching a name
npx vitest run -t "applyModules"
```

`SEED4J_BASE_URL` defaults to `http://localhost:1339`; override via env var. A seed4j server must be running and reachable at that URL for any tool call to succeed.

## Adding a new tool

1. Add a method to `Seed4jClient` for the new seed4j endpoint.
2. Add an entry to `buildTools` in [src/tools.ts](src/tools.ts): name, description (LLM-facing — state what it does, when to use it, how it relates to the other tools), zod `inputSchema` shape, and a handler that delegates to the client.
3. No registration step beyond that — `registerTools` iterates `buildTools` and wires each entry into the MCP server.
4. Add a unit test in [tests/tools.test.ts](tests/tools.test.ts) (delegation) and, if you added a non-trivial transform on the client side, in [tests/client.test.ts](tests/client.test.ts).

## Roadmap execution workflow (MUST follow for every roadmap item)

When the user asks to "execute the roadmap", "work on item N", or otherwise picks up a [docs/ROADMAP.md](docs/ROADMAP.md) entry, follow this loop for **each** item — do not skip steps even if the conversation is fresh:

1. **Explain before coding.** Before touching any source file, post a short summary covering:
   - **What it covers** — the scope of the change in plain language.
   - **Goal** — why it matters for the project / users.
   - **User-visible output** — what an MCP client / agent will see differently once it ships (new tool, new field, new error shape, env var, etc.).
   Wait for the user to react / approve before proceeding with the implementation.
2. **Keep the docs alive.** Maintain the [docs/](docs/) folder, which documents the **current** state of the MCP server (overview, tools, configuration, errors, client setup, develop, changelog). Every roadmap item must update the relevant `docs/` pages so the documentation always reflects what is shipped — never leave the docs stale. Append a per-item entry to [docs/changelog.md](docs/changelog.md).
3. **Suggest a commit, do not commit.** When the implementation + tests + docs are done, propose a commit message (subject + body), but **never** run `git commit`. The user commits themselves.
4. **Mark the roadmap entry done.** Edit [docs/ROADMAP.md](docs/ROADMAP.md) to flag the completed item (e.g. prepend `✅ ` to the heading or strike it through) so the next iteration picks the next open item.

These rules are sticky — they apply for the whole roadmap, across sessions, until every item is done.
