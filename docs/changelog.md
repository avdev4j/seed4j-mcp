# Changelog

User-visible deltas as [ROADMAP.md](ROADMAP.md) items land. The roadmap is the source of truth for **what** is planned; this file records **what shipped**, with the per-item user impact.

## Unreleased

### #10 — Expose the catalogue as MCP resources

- **Shipped:** 2026-05-29
- **User impact:** the module catalogue, landscape, and preset list are now also available as MCP **resources** alongside the existing tools — addressable via `seed4j://catalogue/modules`, `seed4j://catalogue/landscape`, and `seed4j://catalogue/presets`. Clients that render `resources/list` (resource pickers, sidebars) can browse the catalogue without burning a tool call, and the data can be attached to a conversation once instead of being re-fetched every turn. Resource reads hit the same catalogue cache the tools use, so a tool call and a resource read for the same backing endpoint share the same cache entry.
- **API change:** new public `Seed4jClient.getModulesLandscape()` (existing inline `getText("/api/modules-landscape")` callers unchanged). New module [`src/resources.ts`](../src/resources.ts) with `buildResources` / `registerResources`. `src/server.ts` now calls both registrations. No change to existing tools.
- **Docs touched:** [overview.md](overview.md), [tools.md](tools.md), [resources.md](resources.md) (new), [README.md](README.md) (index).

### #9 — Dry-run / preview before applying a module

- **Shipped:** 2026-05-28
- **User impact:** new `preview_module` tool runs a module against a **scratch copy** of the project folder and reports the file-level diff (added / modified / deleted with sizes) — without touching the real project. Auto-selects `copy` mode (diff vs current project state) or `empty` mode (when the folder doesn't exist yet, useful for previewing `init` before `create_project`). Always runs with `commit: false`. Enables a safe `validate_properties → preview_module → user confirms → apply_module` flow that shows the user a concrete plan instead of an English summary.
- **API change:** new `Seed4jClient.previewModule(slug, folder, properties?)`. Implementation is client-side — no new seed4j endpoint required. Constraint: MCP server and seed4j must share a filesystem (same constraint that already applies to `apply_module`).
- **Docs touched:** [tools.md](tools.md), [overview.md](overview.md).

### #8 — Connectivity / health-check tool

- **Shipped:** 2026-05-28
- **User impact:** new `ping_seed4j` tool answers "is seed4j actually up?" without having to call a real tool and inspect the error. Fires a fresh `/api/modules` liveness probe and a best-effort `/management/info` version probe in parallel, bypassing the catalogue cache and retry layer so the result reflects current connectivity. Returns `{ reachable, ok, baseUrl, endpoint, status, latencyMs, version, checkedAt, error? }`. Default per-call timeout is 5 s (override with `timeoutMs`).
- **API change:** new `Seed4jClient.ping(timeoutMs?)` method. `Seed4jClient.fetchWithTimeout` gained a private optional per-call timeout override (no impact on existing callers).
- **Docs touched:** [tools.md](tools.md), [overview.md](overview.md).

### #7 — Richer `validate_properties` (ENUM, pattern, defaults)

- **Shipped:** 2026-05-28
- **User impact:** `validate_properties` now catches enum and pattern violations that previously passed silently, and surfaces the schema's default values so the agent knows exactly which fallbacks will apply at `apply_module` time. The response payload grows a `defaultsApplied: [{ key, default }]` array; a mandatory key that's missing but has a declared default is **no longer an error** — it's recorded as a default-to-be-applied. Errors stay errors; `valid` is still `errors.length === 0`.
- **API change:** none for the tool input; the response shape gains one field. Agents that already parse `errors` / `warnings` keep working; agents that look at `defaultsApplied` get new value.
- **Docs touched:** [tools.md](tools.md).

### #6 — Expose a `commit` option on apply tools

- **Shipped:** 2026-05-28
- **User impact:** every apply tool (`apply_module`, `create_project`, `apply_modules`, `apply_preset`) gains an optional `commit: boolean` input, default `false`. When set to `true`, seed4j runs `git commit` after applying each module — agents that scaffold a project end-to-end now have a one-line way to produce a clean per-feature git history. Existing callers see no change.
- **API change:** `Seed4jClient.applyModule` / `createProject` / `applyModules` / `applyPreset` gain a trailing optional `commit = false` parameter. The flag flows into the apply-patch request body.
- **Docs touched:** [tools.md](tools.md).

### #5 — In-memory cache for the module catalogue, landscape, and presets

- **Shipped:** 2026-05-28
- **User impact:** repeated calls to `list_modules`, `search_modules`, `list_presets`, `get_preset_details`, `apply_preset`, and `get_module_dependencies` no longer refetch their underlying catalogue / landscape / presets endpoint within the TTL — they replay a cached body. Default TTL is **1 hour**, override via the new `SEED4J_CACHE_TTL_MS` env var (set to `0` to disable, useful when iterating on seed4j itself). Errors are never cached.
- **API change:** `Seed4jClient` gains `cacheTtlMs` and `now` (injectable clock) options, plus a public `clearCache(path?)` method. `loadConfig` parses `SEED4J_CACHE_TTL_MS`.
- **Docs touched:** [overview.md](overview.md), [configuration.md](configuration.md).

### #4 — Structured tool errors instead of thrown rejections

- **Shipped:** 2026-05-28
- **User impact:** every tool now returns failures as a proper MCP error result — `{ isError: true, content: [{ type: "text", text: <JSON> }] }` — instead of throwing into the JSON-RPC layer. The JSON payload exposes the error kind (`http` / `timeout` / `client` / `unknown`), the originating endpoint and status, a 500-char excerpt of seed4j's response body, and an actionable hint. Agents can now route on the kind rather than parse free-form English, MCP clients render the failure gracefully instead of aborting the turn, and the context window stays clean.
- **API change:** none on the client side; `Seed4jClient` keeps throwing `HttpError` / `TimeoutError`. `ToolResult` gains an optional `isError` field, populated by a new `wrap` helper applied to every tool in `buildTools`.
- **Docs touched:** [overview.md](overview.md), [errors.md](errors.md).

### #3 — Configurable client via env vars

- **Shipped:** 2026-05-28
- **User impact:** the server can now be tuned and authenticated through environment variables alone — no code changes required. `SEED4J_TIMEOUT_MS` and `SEED4J_RETRIES` override the defaults shipped in #1 and #2; `SEED4J_AUTH_HEADER` (or the convenience `SEED4J_BEARER_TOKEN`) injects an `Authorization` header on every outbound request, unlocking remote/secured seed4j instances. Invalid values warn on stderr and fall back to defaults — the server never fails to start because of a bad env var.
- **API change:** `Seed4jClient` gains an `authHeader` option. New module [`src/config.ts`](../src/config.ts) exposes `loadConfig(env)` returning `{ baseUrl, clientOptions, warnings }`.
- **Docs touched:** [overview.md](overview.md), [configuration.md](configuration.md), [clients.md](clients.md), [errors.md](errors.md).

### #2 — Retry with backoff on transient failures

- **Shipped:** 2026-05-28
- **User impact:** transient seed4j failures on read-only endpoints (network glitches, timeouts, HTTP 5xx) no longer fail the whole tool call. GETs are retried up to twice (3 attempts total) with capped exponential backoff before surfacing the last error. HTTP 4xx and POST `apply-patch` calls are never silently retried.
- **API change:** `Seed4jClient` accepts three new optional options — `retries` (default 2), `retryBaseDelayMs` (default 200), `retryMaxDelayMs` (default 2000) — plus an injectable `sleep` for testing. Env wiring (`SEED4J_RETRIES`) lands with roadmap #3.
- **Docs touched:** [overview.md](overview.md), [errors.md](errors.md), [configuration.md](configuration.md).

### #1 — HTTP timeouts and abort

- **Shipped:** 2026-05-28
- **User impact:** every tool call now fails fast with a `TimeoutError` (default 30 s) when seed4j hangs or is unreachable, instead of stalling the MCP client indefinitely. The error message names the HTTP method, URL, and the timeout value.
- **API change:** `Seed4jClient` accepts a new optional `{ timeoutMs }` constructor option. Env-driven configuration (`SEED4J_TIMEOUT_MS`) is still pending — tracked as roadmap #3.
- **Docs touched:** [overview.md](overview.md), [errors.md](errors.md), [configuration.md](configuration.md).

<!--
Template:

## #N — Title

- **Shipped:** YYYY-MM-DD
- **User impact:** one or two sentences on what an MCP client sees differently.
- **Docs touched:** list of docs/ pages updated.
-->
