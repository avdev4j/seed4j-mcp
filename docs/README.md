# seed4j-mcp — Documentation

This folder documents the **current** state of the seed4j MCP server: what it exposes to MCP clients/agents, how it talks to seed4j, how it is configured, and how failures surface. It is kept in lock-step with the code as [ROADMAP.md](ROADMAP.md) items land — when you change a tool, an env var, or an error shape, update the matching page here.

## Contents

- [overview.md](overview.md) — what this MCP server is, the layers, the runtime contract (STDIO).
- [tools.md](tools.md) — every MCP tool exposed today: name, inputs, output, when to use it.
- [resources.md](resources.md) — read-only MCP resources for the catalogue (modules, landscape, presets).
- [prompts.md](prompts.md) — MCP prompts that encode the curated-stack and custom-stack flows.
- [clients.md](clients.md) — wiring the server into Claude Code, Claude Desktop, Cursor and other MCP clients.
- [configuration.md](configuration.md) — env vars consumed at startup and their defaults.
- [errors.md](errors.md) — how failures are surfaced to the agent today.
- [develop.md](develop.md) — local development setup, tests, STDIO caveat.
- [changelog.md](changelog.md) — roadmap items as they ship, with the user-visible delta.
- [ROADMAP.md](ROADMAP.md) — planned improvements, one per numbered entry.

If you are an MCP client / agent integrator, start with [clients.md](clients.md), [tools.md](tools.md), [resources.md](resources.md), and [prompts.md](prompts.md). If you are operating the server, start with [configuration.md](configuration.md). If you are contributing code, start with [develop.md](develop.md).
