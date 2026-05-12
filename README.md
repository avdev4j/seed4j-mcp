# seed4j-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes [seed4j](https://github.com/seed4j) — an open source application generator — to AI agents.

Instead of a human driving seed4j directly, an MCP-aware agent (Claude Code, Claude Desktop, Cursor, etc.) calls the tools below to discover modules, plan a stack, and scaffold a project.

This repo is a **side project of seed4j**, deliberately kept out of the main seed4j repository. The server talks to a running seed4j instance over HTTP — it does not embed seed4j as a library.

## Requirements

- Java 25+
- A running seed4j instance reachable over HTTP (default `http://localhost:1339`)

## Build & run

```bash
# Build the fat jar
./mvnw clean package

# Run the server (STDIO — typically launched by an MCP client, not directly)
./mvnw spring-boot:run
```

`seed4j.base-url` defaults to `http://localhost:1339`. Override it with:

```bash
SEED4J_BASE_URL=http://localhost:7471 ./mvnw spring-boot:run
# or
java -Dseed4j.base-url=http://localhost:7471 -jar target/seed4j-mcp-0.0.1-SNAPSHOT.jar
```

## Configure an MCP client

The server speaks MCP over **STDIO**. Point your client at the built jar:

```json
{
  "mcpServers": {
    "seed4j": {
      "command": "java",
      "args": ["-jar", "/absolute/path/to/seed4j-mcp/target/seed4j-mcp-0.0.1-SNAPSHOT.jar"],
      "env": {
        "SEED4J_BASE_URL": "http://localhost:1339"
      }
    }
  }
}
```

For Claude Code, add it via `claude mcp add` or edit your project's `.mcp.json` with the same shape.

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

## Tests

```bash
./mvnw test                                     # all tests
./mvnw test -Dtest=Seed4jToolsTest              # one class
./mvnw test -Dtest=Seed4jToolsTest#listModulesReturnsCategorisedJson   # one method
```

## STDIO caveat

MCP framing lives on stdout, so **nothing else may write to stdout**. The Spring banner is off, the web context is disabled, and the console log pattern is blanked in [application.yml](src/main/resources/application.yml). If you add logging or `System.out` calls, route them to the file appender (`./logs/seed4j-mcp.log`) — anything on stdout will corrupt the MCP stream and the client will hang.

## License

Apache License 2.0 — see [LICENSE](LICENSE).
