# Getting Started

This guide gets `seed4j-mcp` from "never seen it before" to "connected to an MCP client and ready to scaffold a project".

## What you need

- Node.js 20+
- An MCP-capable client, such as Codex, Claude Code, Claude Desktop, Cursor, an IDE integration, an automation runner, or a custom MCP host
- A running seed4j instance reachable over HTTP

By default the MCP server expects seed4j at `http://localhost:1339`. If your seed4j instance runs elsewhere, set `SEED4J_BASE_URL`.

## 1. Start seed4j

Run seed4j however you normally do for local development or deployment. The important part for this MCP server is that its HTTP API is reachable:

```bash
curl http://localhost:1339/api/modules
```

If that endpoint responds, `seed4j-mcp` can use it. For a remote or secured seed4j instance, keep the base URL and credentials ready for step 3.

## 2. Choose how to run `seed4j-mcp`

The recommended entrypoint is `npx`, so your MCP client can fetch and run the package on demand:

```bash
npx -y seed4j-mcp
```

For local development on this repository:

```bash
npm install
npm run dev
```

The server speaks MCP over STDIO. It is usually launched by an MCP client, not by a human typing tool calls into the terminal.

If you use `npm install -g seed4j-mcp` instead of `npx`, configure the absolute binary path from `which seed4j-mcp`. Desktop clients may not inherit your terminal's `nvm`/Node `PATH`, so a bare `seed4j-mcp` command can launch a different global install than the one you just checked.

## 3. Connect an MCP client

For Codex:

```bash
codex mcp add seed4j -- npx -y seed4j-mcp
```

For Claude Code:

```bash
claude mcp add seed4j --scope project -- npx -y seed4j-mcp
```

For Claude Desktop, Cursor, and other JSON-configured MCP clients or hosts:

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

When seed4j runs somewhere else, pass the base URL:

```bash
codex mcp add seed4j \
  --env SEED4J_BASE_URL=https://seed4j.example.com \
  -- npx -y seed4j-mcp
```

```bash
claude mcp add seed4j \
  --env SEED4J_BASE_URL=https://seed4j.example.com \
  -- npx -y seed4j-mcp
```

For secured seed4j instances, add either `SEED4J_BEARER_TOKEN` or the full `SEED4J_AUTH_HEADER`. See [configuration.md](configuration.md) for the full environment reference.

## 4. Verify the connection

Ask your MCP client, assistant, or agent host to call:

```text
ping_seed4j
```

Expected result:

- `reachable: true` means the MCP server reached the seed4j HTTP API.
- `ok: true` means seed4j returned a 2xx response for the catalogue liveness check.
- `version` is best-effort and may be `null` if seed4j does not expose it.

If `ping_seed4j` fails, check:

- `SEED4J_BASE_URL` points at the seed4j HTTP server, not the MCP server.
- seed4j is already running before the MCP client starts this server.
- any required auth header is present in the MCP client config.
- no logs or debug output are being written to stdout. STDIO framing needs stdout reserved for MCP messages.

More failure examples live in [errors.md](errors.md).

## 5. Try a first flow

For discovery:

```text
list_modules
```

For a guided curated stack:

```text
Use the seed4j-curated-stack prompt to create a Java application in /absolute/path/to/my-app.
```

For a custom stack:

```text
Use the seed4j-custom-stack prompt to build a Maven Java project with the modules that fit best.
```

Good MCP consumers should follow this shape before mutating a project:

1. Discover modules or presets.
2. Fetch module details and dependencies.
3. Validate properties.
4. Preview the file changes.
5. Ask for confirmation.
6. Apply the module, modules, or preset.
7. Check project status.

The detailed tool contracts are in [tools.md](tools.md), and the built-in prompt flows are in [prompts.md](prompts.md).

## Next steps

| If you are...                      | Read next                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| Wiring an MCP client               | [clients.md](clients.md)                                                     |
| Configuring a remote seed4j        | [configuration.md](configuration.md)                                         |
| Debugging a failed tool call       | [errors.md](errors.md), [logging.md](logging.md)                             |
| Browsing available MCP features    | [tools.md](tools.md), [resources.md](resources.md), [prompts.md](prompts.md) |
| Contributing code                  | [develop.md](develop.md), [overview.md](overview.md)                         |
| Verifying seed4j API compatibility | [seed4j-api.md](seed4j-api.md)                                               |
