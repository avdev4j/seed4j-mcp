# Resources

MCP defines a separate primitive — **resources** — for read-only, addressable data that the client can list, attach, or render without burning a tool call. This server registers three resources alongside the [tools](tools.md):

| URI                            | Name                | Backed by                                                     | MIME type          |
| ------------------------------ | ------------------- | ------------------------------------------------------------- | ------------------ |
| `seed4j://catalogue/modules`   | `modules-catalogue` | `Seed4jClient.listModules` → `/api/modules`                   | `application/json` |
| `seed4j://catalogue/landscape` | `modules-landscape` | `Seed4jClient.getModulesLandscape` → `/api/modules-landscape` | `application/json` |
| `seed4j://catalogue/presets`   | `presets-catalogue` | `Seed4jClient.listPresets` → `/api/presets`                   | `application/json` |

All three return the JSON body seed4j produces, verbatim — wrapped in the standard MCP `{ contents: [{ uri, mimeType, text }] }` envelope.

## When to use a resource vs. a tool

| Scenario                                                               | Use                                         |
| ---------------------------------------------------------------------- | ------------------------------------------- |
| Agent needs the catalogue _now_ to make a decision in the current turn | `list_modules` tool                         |
| Client wants to render the catalogue in a sidebar / picker / file tree | `seed4j://catalogue/modules` resource       |
| Agent needs the dependency-ranked landscape for one specific module    | `get_module_dependencies` tool              |
| Client wants to browse / attach the whole landscape once               | `seed4j://catalogue/landscape` resource     |
| Agent needs the preset list inline to commit to one                    | `list_presets` / `get_preset_details` tools |
| Client wants to surface the preset catalogue for human browsing        | `seed4j://catalogue/presets` resource       |

Resources can be attached to a conversation **once** instead of being re-fetched on every turn — useful for keeping large static data out of tool-call round-trips.

## Cache reuse

Resource reads hit the same `Seed4jClient.getText` path the tools use, so the catalogue cache from roadmap #5 (default 1 h TTL, configurable via `SEED4J_CACHE_TTL_MS`) protects them too. A tool call and a resource read for the same backing endpoint share the same cache entry — verified in [tests/resources.test.ts](../tests/resources.test.ts).

## Errors

Resource read failures **do not** go through the structured-error wrapper the tools use (roadmap #4). Underlying `HttpError` / `TimeoutError` propagate as JSON-RPC errors, matching MCP convention for `resources/read`. Clients render them per the spec.

## What's not exposed as a resource

- **Per-module schemas** (`seed4j://module/{slug}`). The roadmap names three top-level resources; per-module templates would multiply the surface and complicate caching. Stays a tool (`get_module_details`).
- **Project status** (`seed4j://project/{path}`). Per-project, short-lived, not cached — wrong primitive. Stays a tool (`get_project_status`).
- **Change notifications** (`subscribe`, `notifications/resources/list_changed`). The cache TTL handles freshness; subscriptions would be overkill.
