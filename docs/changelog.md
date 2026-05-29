# Changelog

User-visible deltas as [ROADMAP.md](ROADMAP.md) items land. The roadmap is the source of truth for **what** is planned; this file records **what shipped**, with the per-item user impact.

## Unreleased

### #16 — CI: typecheck + test on PRs, and lint

- **Shipped:** 2026-05-29
- **User impact:** none at runtime. CI already ran `npm ci → typecheck → build → test` on every push to `main` and every PR; this item adds **lint** and **format check** as new gates before typecheck, so PRs with style violations fail fast. Locally: four new commands — `npm run lint`, `npm run lint:fix`, `npm run format`, `npm run format:check`.
- **Stack:** ESLint v9 with `typescript-eslint` (flat config), Prettier v3, `eslint-config-prettier` as the bridge. Project-specific rules: `@typescript-eslint/no-unused-vars` errors with `_`-prefixed escape hatch, `@typescript-eslint/no-explicit-any` warns instead of errors (so existing intentional `as unknown as ...` casts survive review), `no-console` left off (stderr is fine).
- **Source diffs:** Prettier reformatted 24 files (markdown tables widened, line breaks tightened) and ESLint flagged one dead variable in [tests/client.test.ts](../tests/client.test.ts). Folded into the same change so future PRs start green.
- **Docs touched:** [develop.md](develop.md), [CLAUDE.md](../CLAUDE.md).

### #15 — Verify and document seed4j API stability

- **Shipped:** 2026-05-29
- **User impact:** the seed4j contract — every endpoint we call, every field we read, every status code we react to — is now pinned in [seed4j-api.md](seed4j-api.md), verified against the seed4j `main` branch. `scripts/verify-seed4j-api.ts` (`npm run verify:api`) lets an operator confirm the contract still holds after seed4j upgrades.
- **Divergence found:** the `/api/projects` JSON root carries `modules`, not `appliedModules`, and each entry is just `{ slug }`. The [tests/fixtures/project-status.json](../tests/fixtures/project-status.json) fixture and the corresponding integration test were corrected. `Seed4jClient.getProjectStatus` was already correct (it forwards the body unchanged), so no runtime behaviour changed.
- **Known seed4j-side gap (now explicit):** the `/api/modules/{slug}` response does **not** expose `enumValues` or `pattern` fields. The validation code shipped in #7 is defensive (multiple field-name fallbacks) and harmless against current seed4j payloads — it'll activate the moment seed4j surfaces those fields.
- **API change:** none on the runtime. New module [`scripts/verify-seed4j-api.ts`](../scripts/verify-seed4j-api.ts) + `npm run verify:api`. Each `Seed4jClient` endpoint method gained a `// Contract: docs/seed4j-api.md#…` comment.
- **Docs touched:** [seed4j-api.md](seed4j-api.md) (new), [overview.md](overview.md), [README.md](README.md) (index), [CLAUDE.md](../CLAUDE.md).

### #14 — Integration tests against a mock seed4j server

- **Shipped:** 2026-05-29
- **User impact:** none at runtime — tests-only. Adds 14 end-to-end tests that boot a real `node:http` server per suite on an ephemeral port and exercise `Seed4jClient` with the global `fetch`. Catches URL / body / parse drift, `Authorization` propagation, retry across real sockets, and `AbortController`-driven timeouts — failure modes that hand-written `vi.fn()` mocks can't see.
- **API change:** none. Pure additive tests + fixtures.
- **Docs touched:** [CLAUDE.md](../CLAUDE.md), [develop.md](develop.md).

### #13 — Optional file-based debug logging

- **Shipped:** 2026-05-29
- **User impact:** new `SEED4J_LOG_FILE` env var enables a JSONL debug log that captures every outbound HTTP request, response, retry, cache hit/populate, timeout, and error — one structured line per event. Operators finally have a deterministic trail for "why did the apply call fail at 3am" on a STDIO MCP server where `console.log` is off-limits. When the var is unset (default), the logger is a frozen no-op singleton — zero overhead. Stdout is never written to. Authorization headers and request/response bodies are never logged.
- **API change:** new module [`src/logger.ts`](../src/logger.ts) with `Logger`, `createLogger`, `noopLogger`. `Seed4jClient` accepts a `logger` option; `loadConfig` now returns `logFile`; the entrypoint constructs the logger, registers an `exit` close hook, and passes it to the client.
- **Docs touched:** [configuration.md](configuration.md), [logging.md](logging.md) (new), [overview.md](overview.md), [README.md](README.md) (index).

### #12 — Single-source the server version

- **Shipped:** 2026-05-29
- **User impact:** the MCP server now advertises the **real** package version in its `initialize` handshake — whatever `package.json` says — instead of the previously-hardcoded `0.0.1`. Whoever bumps the release also bumps what every MCP client sees. No new env var, no API change.
- **API change:** new tiny module [`src/version.ts`](../src/version.ts) reads `package.json` synchronously at module load and exports `PACKAGE_VERSION`. `createServer` defaults `options.version` to `PACKAGE_VERSION`; the `options.version` override is preserved for tests. On read failure, falls back to `0.0.0` with a one-line stderr warning (stdout stays clean).
- **Docs touched:** [overview.md](overview.md).

### #11 — Ship MCP prompts for common flows

- **Shipped:** 2026-05-29
- **User impact:** two new MCP prompts encode the documented seed4j flows as slash-style starters: `seed4j-curated-stack` (`list_presets → get_preset_details → preview_module → apply_preset`) and `seed4j-custom-stack` (`search_modules → get_module_dependencies → validate_properties → preview_module → apply_modules`). Each takes `stackDescription` (required) and `projectFolder` (optional) and returns one user-role message that lists the exact tool sequence to follow — so a fresh agent can't mis-order calls, and humans can see the on-ramp in their MCP client's prompt picker.
- **API change:** new module [`src/prompts.ts`](../src/prompts.ts) with `buildPrompts` / `registerPrompts`. `src/server.ts` now calls all three registrations (tools + resources + prompts). No change to existing tools, resources, or `Seed4jClient`.
- **Docs touched:** [overview.md](overview.md), [tools.md](tools.md), [prompts.md](prompts.md) (new), [README.md](README.md) (index).

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
