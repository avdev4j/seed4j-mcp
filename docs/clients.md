# MCP client setup

The server speaks MCP over **STDIO**, so any MCP-aware client, assistant, automation runner, or custom host that can launch a subprocess can use it. `SEED4J_BASE_URL` defaults to `http://localhost:1339` — override it when seed4j runs elsewhere.

## Install

`seed4j-mcp` is published on npm. The recommended way to run it is via `npx`, so no manual install is needed — your MCP client will fetch and run the latest release on demand:

```bash
npx -y seed4j-mcp
```

If you prefer a global install:

```bash
npm install -g seed4j-mcp
```

To build from source, see [develop.md](develop.md).

## Codex

Use the `codex mcp add` command:

```bash
codex mcp add seed4j -- npx -y seed4j-mcp
```

Pass a custom seed4j URL — or any other [supported env var](configuration.md) — with `--env`:

```bash
codex mcp add seed4j \
  --env SEED4J_BASE_URL=https://seed4j.example.com \
  --env SEED4J_BEARER_TOKEN=eyJhbGciOi... \
  --env SEED4J_TIMEOUT_MS=60000 \
  -- npx -y seed4j-mcp
```

Verify it's wired up:

```bash
codex mcp list
```

## Claude Code

Use the `claude mcp add` command. Pick a scope: `local` (default — current project, your machine), `project` (committed to `.mcp.json`, shared with the team), or `user` (your machine, every project).

```bash
# Local: just you, this project
claude mcp add seed4j -- npx -y seed4j-mcp

# Project: committed to .mcp.json, shared with collaborators
claude mcp add seed4j --scope project -- npx -y seed4j-mcp

# User: available across all your projects
claude mcp add seed4j --scope user -- npx -y seed4j-mcp
```

Pass a custom seed4j URL — or any other [supported env var](configuration.md) — with `--env`:

```bash
claude mcp add seed4j \
  --env SEED4J_BASE_URL=https://seed4j.example.com \
  --env SEED4J_BEARER_TOKEN=eyJhbGciOi... \
  --env SEED4J_TIMEOUT_MS=60000 \
  -- npx -y seed4j-mcp
```

Verify it's wired up:

```bash
claude mcp list
```

## Claude Desktop, Cursor, and other JSON-config clients

Point the client or host application at the `npx` entrypoint in its MCP servers config:

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

Add any of the [supported env vars](configuration.md) (timeout, retries, bearer token, …) to the `env` block.

If you installed `seed4j-mcp` globally, swap `npx`/`-y seed4j-mcp` for `seed4j-mcp` directly.

## Verifying the connection

Once wired, the client should list the tools documented in [tools.md](tools.md). A first sanity check is to call `ping_seed4j`; it confirms whether seed4j is reachable at the configured base URL without mutating a project. `list_modules` is the next useful check because it returns the seed4j catalogue.
