<p align="center">
  <img src="brand/logo.svg" alt="seed4j-mcp" width="180">
</p>

# seed4j-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [seed4j](https://github.com/seed4j) — an open source application generator — to AI agents.

Instead of a human driving seed4j directly, an MCP-aware agent (Claude Code, Claude Desktop, Cursor, …) calls the tools below to discover modules, plan a stack, and scaffold a project.

This repo is a **side project of seed4j**, deliberately kept out of the main seed4j repository. The server talks to a running seed4j instance over HTTP — it does not embed seed4j as a library.

## Quick start

You'll need Node.js 20+ and a running seed4j instance (default `http://localhost:1339`). The server is published on npm as [`seed4j-mcp`](https://www.npmjs.com/package/seed4j-mcp); the recommended entrypoint is `npx`:

```bash
# Claude Code (project scope, shared via .mcp.json)
claude mcp add seed4j --scope project -- npx -y seed4j-mcp

# Any other MCP client (JSON config)
# {
#   "mcpServers": {
#     "seed4j": { "command": "npx", "args": ["-y", "seed4j-mcp"] }
#   }
# }
```

Detailed setup per client (scopes, custom `SEED4J_BASE_URL`, global install) lives in [docs/clients.md](docs/clients.md).

## Documentation

All reference docs live under [docs/](docs/):

- [docs/overview.md](docs/overview.md) — what the server is, the layers, the STDIO runtime contract.
- [docs/tools.md](docs/tools.md) — every MCP tool exposed today, with inputs/outputs and when to use it.
- [docs/resources.md](docs/resources.md) — read-only MCP resources for the catalogue (modules, landscape, presets).
- [docs/clients.md](docs/clients.md) — wiring the server into Claude Code, Claude Desktop, Cursor, …
- [docs/configuration.md](docs/configuration.md) — environment variables and their defaults.
- [docs/errors.md](docs/errors.md) — how failures surface to the agent.
- [docs/develop.md](docs/develop.md) — local dev setup, tests, STDIO caveat.
- [docs/changelog.md](docs/changelog.md) — what shipped, per roadmap item.
- [docs/ROADMAP.md](docs/ROADMAP.md) — planned improvements.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
