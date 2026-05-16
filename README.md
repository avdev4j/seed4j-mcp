<p align="center">
  <img src="brand/logo.svg" alt="seed4j-mcp" width="180">
</p>

# seed4j-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [seed4j](https://github.com/seed4j) — an open source application generator — to AI agents.

Instead of a human driving seed4j directly, an MCP-aware agent (Claude Code, Claude Desktop, Cursor, etc.) calls the tools below to discover modules, plan a stack, and scaffold a project.

This repo is a **side project of seed4j**, deliberately kept out of the main seed4j repository. The server talks to a running seed4j instance over HTTP — it does not embed seed4j as a library.

## Requirements

- Node.js 20+
- A running seed4j instance reachable over HTTP (default `http://localhost:1339`)

## Install

The server is published to npm as [`seed4j-mcp`](https://www.npmjs.com/package/seed4j-mcp). The recommended way to run it is via `npx`, so no manual install is needed — your MCP client will fetch and run the latest release on demand.

If you'd rather install it globally:

```bash
npm install -g seed4j-mcp
```

To build from source instead, see [Develop](#develop) below.

## Configure an MCP client

The server speaks MCP over **STDIO**. `SEED4J_BASE_URL` defaults to `http://localhost:1339`.

### Claude Code

Use the `claude mcp add` command. Pick a scope: `local` (default — current project, your machine), `project` (committed to `.mcp.json`, shared with the team), or `user` (your machine, every project).

```bash
# Local: just you, this project
claude mcp add seed4j -- npx -y seed4j-mcp

# Project: committed to .mcp.json, shared with collaborators
claude mcp add seed4j --scope project -- npx -y seed4j-mcp

# User: available across all your projects
claude mcp add seed4j --scope user -- npx -y seed4j-mcp
```

Pass a custom seed4j URL with `--env`:

```bash
claude mcp add seed4j --env SEED4J_BASE_URL=http://localhost:7471 -- npx -y seed4j-mcp
```

Verify it's wired up:

```bash
claude mcp list
```

### Other MCP clients

For Claude Desktop, Cursor, and other clients that read a JSON config, point them at the `npx` entrypoint:

```json
{
  "mcpServers": {
    "seed4j": {
      "command": "npx",
      "args": ["-y", "seed4j-mcp"],
      "env": {
        "SEED4J_BASE_URL": "http://localhost:1339"
      }
    }
  }
}
```

If you installed `seed4j-mcp` globally, swap `npx`/`-y seed4j-mcp` for `seed4j-mcp` directly.

## Tools exposed to the agent

| Tool | Purpose |
| --- | --- |
| `list_modules` | List every available seed4j module, grouped by category. |
| `search_modules` | Keyword search across module slugs, descriptions, tags, and categories. |
| `get_module_details` | Property definitions (mandatory/optional inputs, defaults, types) for one module. |
| `get_module_dependencies` | Prerequisite graph + feature choices for a module — call before `apply_module`. |
| `validate_properties` | Dry-run check of a property map against a module's schema (no mutation). |
| `list_presets` | Curated, pre-ordered stacks (e.g. "Webapp: Vue + Spring Boot"). |
| `get_preset_details` | Fetch one preset by name with its ordered module list. |
| `get_project_status` | History of a seed4j project folder: applied modules and aggregated properties. |
| `create_project` | Initialise a new base project at a target folder. |
| `apply_module` | Apply a module to an existing project folder. |
| `apply_modules` | Apply an ordered list of modules to one folder in a single call (stops on first failure). |
| `apply_preset` | Resolve a preset by name and apply all its modules with a shared property map. |

Typical agent flows:

- **Curated stack:** `list_presets` → `get_preset_details` → `apply_preset`.
- **Custom stack:** `search_modules` → `get_module_dependencies` → `validate_properties` → `apply_modules` (one batch call covering the dependency order).

## Develop

Clone the repo and run from source:

```bash
npm install
npm run dev                         # run from sources via tsx
npm run build && npm start          # compile to dist/ and run the built entrypoint
```

Override `SEED4J_BASE_URL` to point at a non-default seed4j instance:

```bash
SEED4J_BASE_URL=http://localhost:7471 npm start
```

## Tests

```bash
npm test                            # all tests
npm run test:watch                  # watch mode
npx vitest run tests/client.test.ts # one file
```

## STDIO caveat

MCP framing lives on stdout, so **nothing else may write to stdout**. The entrypoint routes startup errors to stderr; do not add `console.log` or other stdout writes from the tool handlers, or the MCP stream will be corrupted and the client will hang.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
