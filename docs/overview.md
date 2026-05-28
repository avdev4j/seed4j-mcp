# Overview

`seed4j-mcp` is a [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [seed4j](https://github.com/seed4j) — an application generator — to AI agents. The agent calls MCP tools and the server translates each call into HTTP requests against a **running seed4j instance**. seed4j is not embedded as a library.

## Runtime contract

- **Transport:** STDIO. The MCP framing lives on stdout, so the server must never write anything else to stdout. Startup errors and any operational logging go to **stderr**.
- **Process model:** one long-lived Node.js process per MCP client connection. Launched by the MCP client (Claude Desktop, IDE plugin, custom agent, …).
- **State:** stateless. Every tool call hits seed4j over HTTP. No in-process cache today (see roadmap item 5).

## Layers

| Layer | File | Responsibility |
| --- | --- | --- |
| Entry point | [src/index.ts](../src/index.ts) | Load config from env, emit warnings on stderr, build the client, wire the STDIO transport, connect the server. |
| Config | [src/config.ts](../src/config.ts) | Pure env → `{ baseUrl, clientOptions, warnings }` parser. No I/O. |
| Server | [src/server.ts](../src/server.ts) | Construct the `McpServer` and register tools. |
| Tools | [src/tools.ts](../src/tools.ts) | The MCP-facing surface — names, descriptions, zod schemas, handlers. |
| Client | [src/client.ts](../src/client.ts) | HTTP calls into seed4j; the only layer that knows about `fetch`. |

## seed4j HTTP endpoints used

These paths are inherited from the JHipster-Lite-style API. Verify them against the running seed4j before assuming they're stable (see roadmap item 15).

| Method | Path | Used by |
| --- | --- | --- |
| GET | `/api/modules` | `list_modules`, `search_modules` |
| GET | `/api/modules/{slug}` | `get_module_details`, `validate_properties` |
| POST | `/api/modules/{slug}/apply-patch` | `apply_module`, `apply_modules`, `apply_preset`, `create_project` |
| GET | `/api/presets` | `list_presets`, `get_preset_details`, `apply_preset` |
| GET | `/api/projects?path=…` | `get_project_status` |
| GET | `/api/modules-landscape` | `get_module_dependencies` |

`create_project` is **not** a dedicated endpoint: it `mkdir`s the target folder locally and then applies the `init` module via `apply-patch`.

## Reliability

- **Per-request timeout.** Every outbound `fetch` is wrapped with an `AbortController` armed for a configurable timeout (default 30 s, override via `SEED4J_TIMEOUT_MS`). When it fires, the request is aborted and the tool call rejects with a `TimeoutError` instead of stalling the MCP client — see [errors.md](errors.md).
- **Retries on idempotent GETs.** GETs (`/api/modules`, `/api/modules/{slug}`, `/api/presets`, `/api/modules-landscape`, `/api/projects?path=…`) are retried up to `retries` times (default **2**, override via `SEED4J_RETRIES`) on `TimeoutError`, network errors, and HTTP 5xx responses. Backoff is capped exponential. HTTP 4xx is **not** retried — those are deterministic. POSTs to `apply-patch` are **never** silently retried; an aborted apply could leave the project half-mutated, so retry is left to the agent.
- **Authenticated seed4j.** When `SEED4J_AUTH_HEADER` (or the convenience `SEED4J_BEARER_TOKEN`) is set, every outbound request — GETs and POSTs — carries an `Authorization` header. See [configuration.md](configuration.md).
- **Structured tool errors.** Every tool handler is wrapped: failures surface to the MCP client as `{ isError: true, content: [{ type: "text", text: <JSON> }] }` with a structured payload (`error` kind, `tool`, `status`, `endpoint`, `bodyExcerpt`, `hint`, …) instead of a raw thrown rejection. seed4j response bodies are truncated to ~500 chars to keep the agent's context clean. See [errors.md](errors.md).
- **Catalogue caching** is not yet in place — see roadmap item #5.
