# seed4j-mcp Documentation

This folder documents the **current** state of the seed4j MCP server: what it exposes to MCP clients, AI coding assistants, autonomous agents, and custom host applications; how it talks to seed4j; how it is configured; and how failures surface.

The goal is simple: a new user should be able to connect the server and run a first tool call in minutes, while a contributor should be able to understand the architecture and make a safe change without spelunking through the whole repository.

## Start Here

| Goal                                                                        | Best first page                                                              |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Connect the MCP server and run a first tool call                            | [getting-started.md](getting-started.md)                                     |
| Configure Codex, Claude Code, Claude Desktop, Cursor, or another MCP client | [clients.md](clients.md)                                                     |
| Understand which tools, resources, and prompts MCP consumers can use        | [tools.md](tools.md), [resources.md](resources.md), [prompts.md](prompts.md) |
| Configure timeouts, retries, auth, cache, or logging                        | [configuration.md](configuration.md), [logging.md](logging.md)               |
| Troubleshoot a failed call                                                  | [errors.md](errors.md)                                                       |
| Contribute to the server                                                    | [develop.md](develop.md), [overview.md](overview.md)                         |
| Verify compatibility with a seed4j upgrade                                  | [seed4j-api.md](seed4j-api.md)                                               |

## Recommended Reading Paths

### Users and MCP Client Integrators

1. [getting-started.md](getting-started.md) — install, connect, verify, and try a first flow.
2. [clients.md](clients.md) — client-specific setup examples and environment wiring.
3. [tools.md](tools.md) — the tool catalogue an MCP client, assistant, or agent can call.
4. [prompts.md](prompts.md) — guided curated-stack and custom-stack flows.
5. [errors.md](errors.md) — what failures look like and what to check next.

### Operators

1. [configuration.md](configuration.md) — environment variables and defaults.
2. [logging.md](logging.md) — opt-in JSONL debug logging.
3. [errors.md](errors.md) — structured tool errors, retries, and timeouts.
4. [seed4j-api.md](seed4j-api.md) — the seed4j HTTP contract this server expects.

### Contributors

1. [overview.md](overview.md) — architecture, runtime contract, and layer responsibilities.
2. [develop.md](develop.md) — local setup, tests, linting, formatting, and CI gates.
3. [tools.md](tools.md), [resources.md](resources.md), [prompts.md](prompts.md) — public MCP surface area.
4. [seed4j-api.md](seed4j-api.md) — endpoint contracts and verification script.
5. [ROADMAP.md](ROADMAP.md) and [changelog.md](changelog.md) — planned work and shipped changes.

## Reference Index

- [getting-started.md](getting-started.md) — the shortest path from install to a verified MCP connection.
- [overview.md](overview.md) — what this MCP server is, the layers, and the STDIO runtime contract.
- [tools.md](tools.md) — every MCP tool exposed today: name, inputs, output, and when to use it.
- [resources.md](resources.md) — read-only MCP resources for the catalogue: modules, landscape, presets.
- [prompts.md](prompts.md) — MCP prompts that encode the curated-stack and custom-stack flows.
- [clients.md](clients.md) — wiring the server into Codex, Claude Code, Claude Desktop, Cursor, custom hosts, and other MCP clients.
- [configuration.md](configuration.md) — env vars consumed at startup and their defaults.
- [errors.md](errors.md) — how failures are surfaced to MCP clients and agents.
- [logging.md](logging.md) — opt-in JSONL debug log (`SEED4J_LOG_FILE`), events, and redaction notes.
- [seed4j-api.md](seed4j-api.md) — verified seed4j HTTP contract: every endpoint, every field we read or send.
- [develop.md](develop.md) — local development setup, tests, CI gates, and STDIO caveat.
- [changelog.md](changelog.md) — shipped changes with the user-visible delta.
- [ROADMAP.md](ROADMAP.md) — planned improvements, one per numbered entry.

## Documentation Rule

Keep these pages in lock-step with the code. When a change adds or alters a tool, resource, prompt, env var, error shape, seed4j endpoint, or operator workflow, update the matching docs in the same change.
