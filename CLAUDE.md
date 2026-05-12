# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Purpose

`seed4j-mcp` is a Model Context Protocol (MCP) server that exposes [seed4j](https://github.com/seed4j) — an open source application generator — to AI agents. The agent drives seed4j through MCP tools instead of a human invoking it directly.

This repo is a **side project of seed4j**, deliberately kept out of the main seed4j repository. Treat seed4j as an external service: this server talks to a running seed4j instance over HTTP, it does not embed seed4j as a library.

## Tech Stack

- Java 21, Spring Boot 3.4, Maven.
- Spring AI 1.0.x — specifically `spring-ai-starter-mcp-server` for MCP over **STDIO** transport.
- `RestClient` (from `spring-web`) for the synchronous HTTP calls into seed4j.

## Architecture

Three layers, kept intentionally thin:

1. **Tools** — [Seed4jTools.java](src/main/java/com/seed4j/mcp/tools/Seed4jTools.java). Each `@Tool`-annotated method is one MCP tool surfaced to the agent. Descriptions on `@Tool` and `@ToolParam` are the *only* documentation the agent sees; treat them as part of the public API. Tools currently return raw JSON `String` from seed4j so the agent sees the richest payload — wrap in typed records only when a tool needs to transform or filter the response.
2. **Client** — [Seed4jClient.java](src/main/java/com/seed4j/mcp/client/Seed4jClient.java). Single component holding a `RestClient` against `seed4j.base-url`. All seed4j HTTP routes live here so the tools layer stays free of transport concerns. The endpoint paths (`/api/modules`, `/api/modules/{slug}`, `/api/modules/{slug}/apply-patch`) match the JHipster-Lite-style API seed4j inherits — verify against the running seed4j instance before assuming they're stable. Project initialisation is *not* a dedicated endpoint; `createProject` ensures the target folder exists and then applies the `init` module via apply-patch.
3. **Config** — [McpServerConfiguration.java](src/main/java/com/seed4j/mcp/config/McpServerConfiguration.java) registers all `@Tool` methods on `Seed4jTools` with the MCP server via a single `MethodToolCallbackProvider` bean. Adding a new tool = adding a new `@Tool` method on `Seed4jTools`; the config does not need to change.

### Tools currently exposed
- `list_modules` — list all modules grouped by category.
- `get_module_details` — prerequisites and dependencies for one module.
- `apply_module` — apply a module to an existing project folder.
- `create_project` — initialise a base project.

### STDIO transport caveat
The server runs over STDIO (`spring.ai.mcp.server.stdio=true`). The MCP framing lives on stdout, so **nothing else may write to stdout** — banner is off, `web-application-type=none`, and the console log pattern is blanked in [application.yml](src/main/resources/application.yml). When adding logging or `System.out` calls, route them to the file appender (`./logs/seed4j-mcp.log`) or you will corrupt the MCP stream and the client will hang.

## Build & Run

```bash
# Build
./mvnw clean package

# Run the MCP server (STDIO — typically launched by an MCP client, not directly)
./mvnw spring-boot:run

# Run all tests
./mvnw test

# Run a single test
./mvnw test -Dtest=Seed4jToolsTest

# Run a single test method
./mvnw test -Dtest=Seed4jToolsTest#listModulesReturnsCategorisedJson
```

`seed4j.base-url` defaults to `http://localhost:7471`; override via env var `SEED4J_BASE_URL` or `-Dseed4j.base-url=...`. A seed4j server must be running and reachable at that URL for any tool call to succeed.

## Adding a new tool

1. Add a method to `Seed4jClient` for the new seed4j endpoint.
2. Add a `@Tool`-annotated method to `Seed4jTools` that delegates to the client. Write the `description` for an LLM reader: state what it does, when to use it, and how it relates to the other tools. Annotate each parameter with `@ToolParam`.
3. No registration step — `MethodToolCallbackProvider` picks it up automatically.
