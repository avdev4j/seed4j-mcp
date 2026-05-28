# seed4j-mcp — Roadmap

Future improvements for the MCP server, written as discrete, numbered features so each can be picked up and implemented **one at a time**. Items are roughly ordered by value-to-effort, but they are independent unless a dependency is called out.

Each feature lists: **What**, **Why**, **Where** (the files most likely touched), and **Done when** (acceptance criteria). When implementing one, also add/extend tests in `tests/` and update the relevant page under [docs/](.) (and [changelog.md](changelog.md)) so the documentation always reflects what is shipped. Completed items are prefixed with `✅`.

---

## Reliability & transport

### ✅ 1. HTTP timeouts and abort
- **What:** Wrap every `fetch` in `Seed4jClient` with an `AbortController` timeout (default e.g. 30s, configurable).
- **Why:** A hung or slow seed4j instance currently blocks a tool call indefinitely; over STDIO this looks like the MCP client freezing.
- **Where:** [src/client.ts](../src/client.ts) (`getText`, `postJson`, `getProjectStatus`).
- **Done when:** A request that exceeds the timeout rejects with a clear, agent-readable error; covered by a test using a fake fetch that never resolves.
- **Shipped:** 2026-05-28 — `Seed4jClient` now accepts `{ timeoutMs }` (default 30 s) and raises `TimeoutError` on hangs. Env wiring (`SEED4J_TIMEOUT_MS`) follows in #3. See [changelog.md](changelog.md#1--http-timeouts-and-abort).

### ✅ 2. Retry with backoff on transient failures
- **What:** Retry idempotent GET calls (catalogue, details, landscape, presets, status) on network errors and 5xx, with capped exponential backoff. Do **not** retry POST/apply-patch by default.
- **Why:** seed4j may be briefly unavailable during startup; agents shouldn't fail a whole plan on a transient blip.
- **Where:** [src/client.ts](../src/client.ts).
- **Done when:** GETs retry up to N times then surface the last error; POSTs are never silently retried; behaviour is unit-tested.
- **Shipped:** 2026-05-28 — `Seed4jClient` retries `TimeoutError` / network errors / HTTP 5xx on GETs (default 2 retries, capped exponential backoff). 4xx and POSTs are never silently retried. Env wiring (`SEED4J_RETRIES`) follows in #3. See [changelog.md](changelog.md#2--retry-with-backoff-on-transient-failures).

### 3. Configurable client via env vars
- **What:** Read `SEED4J_TIMEOUT_MS`, `SEED4J_RETRIES`, and optional `SEED4J_AUTH_HEADER` / bearer token from the environment in [src/index.ts](../src/index.ts) and pass them into `Seed4jClient`.
- **Why:** Different deployments (local vs. remote/secured seed4j) need different tuning without code changes.
- **Where:** [src/index.ts](../src/index.ts), [src/client.ts](../src/client.ts) constructor.
- **Done when:** Env vars are parsed with sane defaults and documented in README; depends conceptually on #1/#2.

### 4. Structured tool errors instead of thrown rejections
- **What:** Catch errors in tool handlers and return `{ content: [...], isError: true }` with a concise, structured message (status, endpoint, hint) rather than letting them reject.
- **Why:** MCP clients render `isError` results gracefully; raw rejections give the agent less to work with and can abort the turn.
- **Where:** [src/tools.ts](../src/tools.ts) (a small `wrap` helper around each handler), [src/client.ts](../src/client.ts) `HttpError`.
- **Done when:** Every tool returns a text error result on failure; `HttpError` body is summarised, not dumped verbatim; tested.

---

## Catalogue performance

### 5. In-memory cache for the module catalogue, landscape, and presets
- **What:** Cache the responses of `/api/modules`, `/api/modules-landscape`, and `/api/presets` with a short TTL inside `Seed4jClient`.
- **Why:** `search_modules` re-fetches the full catalogue every call, and `get_module_dependencies` / `apply_preset` re-fetch on each use. These payloads are large and change rarely within a session.
- **Where:** [src/client.ts](../src/client.ts).
- **Done when:** Repeated calls within the TTL hit the cache (verified by counting fetch calls in a test); a TTL/`refresh` path exists to bust it.

---

## Tool capabilities

### 6. Expose a `commit` option on apply tools
- **What:** Make `commit` (currently hardcoded `false` in `applyModule`) an optional input on `apply_module`, `apply_modules`, `apply_preset`, and `create_project`.
- **Why:** seed4j can git-commit after applying a patch; agents that scaffold a project may want each step committed for a clean history.
- **Where:** [src/client.ts](../src/client.ts) `applyModule`, [src/tools.ts](../src/tools.ts) schemas.
- **Done when:** `commit` flag flows through to the apply-patch body and defaults to `false`; tested.

### 7. Richer `validate_properties` (ENUM, regex/pattern, defaults)
- **What:** Extend `checkType` to validate `ENUM` (value in allowed set), pattern/regex constraints if seed4j exposes them, and report which mandatory keys would fall back to a default.
- **Why:** Current validation only covers STRING/INTEGER/BOOLEAN; agents get false "valid" results for enum/pattern fields.
- **Where:** [src/client.ts](../src/client.ts) `validateProperties` / `checkType`.
- **Done when:** Enum/pattern violations appear in `errors`; behaviour matches seed4j's own schema; tested against representative module schemas.

### 8. Connectivity / health-check tool
- **What:** Add a `ping_seed4j` (or `health`) tool that hits a lightweight endpoint and reports reachability, base URL, and seed4j version if available.
- **Why:** First thing an agent (or a debugging human) wants to know is "is seed4j actually up at the configured URL?" — currently you only find out when a real tool fails.
- **Where:** [src/client.ts](../src/client.ts), [src/tools.ts](../src/tools.ts).
- **Done when:** Tool returns a clear up/down result with the resolved base URL; tested.

### 9. Dry-run / preview before applying a module
- **What:** If seed4j supports a preview/diff mode for apply-patch, expose a `preview_module` tool returning the files that *would* change without mutating the folder.
- **Why:** Lets the agent show the user a plan before touching disk; pairs naturally with `validate_properties`.
- **Where:** [src/client.ts](../src/client.ts), [src/tools.ts](../src/tools.ts).
- **Done when:** Preview returns the change set; gated behind seed4j actually supporting it (verify the endpoint first). Depends on confirming the seed4j API.

---

## MCP surface

### 10. Expose the catalogue as MCP resources
- **What:** Register the module catalogue, landscape, and preset list as MCP **resources** (read-only, addressable URIs) in addition to the tools.
- **Why:** Resources let clients browse/attach the catalogue without a tool call, and keep large static data out of tool-call round-trips.
- **Where:** [src/server.ts](../src/server.ts), new `src/resources.ts`.
- **Done when:** `resources/list` and `resources/read` return the catalogue; cache (#5) is reused.

### 11. Ship MCP prompts for common flows
- **What:** Register prompts for the two documented flows ("curated stack" and "custom stack") so clients can offer them as slash-style starting points.
- **Why:** Encodes the intended `search → dependencies → validate → apply` sequence the agent should follow, reducing mis-ordered calls.
- **Where:** [src/server.ts](../src/server.ts), new `src/prompts.ts`.
- **Done when:** `prompts/list` exposes them and they render the documented flow.

---

## Quality & maintainability

### 12. Single-source the server version
- **What:** Read `version` from `package.json` instead of the hardcoded `"0.0.1"` in [src/server.ts](../src/server.ts).
- **Why:** The version is duplicated and will drift on the next release.
- **Where:** [src/server.ts](../src/server.ts), [src/index.ts](../src/index.ts).
- **Done when:** `createServer` reports the actual package version; no hardcoded literal remains.

### 13. Optional file-based debug logging
- **What:** Behind a `SEED4J_LOG_FILE` env var, log requests/responses/errors to a file (never stdout).
- **Why:** Debugging STDIO MCP servers is painful precisely because stdout is off-limits; a file log is the safe escape hatch (the STDIO caveat in CLAUDE.md).
- **Where:** new `src/logger.ts`, used in [src/client.ts](../src/client.ts) / [src/index.ts](../src/index.ts).
- **Done when:** When the env var is set, structured lines are appended to the file; when unset, nothing is logged and stdout stays clean.

### 14. Integration tests against a mock seed4j server
- **What:** Stand up an in-process HTTP server returning recorded seed4j fixtures, and run the tools end-to-end against it.
- **Why:** Current tests use a fake `fetch`; they don't catch URL/body construction or response-shape regressions against realistic payloads.
- **Where:** new `tests/integration/*`, fixtures under `tests/fixtures/`.
- **Done when:** A suite exercises each tool against the mock and asserts on outputs.

### 15. Verify and document seed4j API stability
- **What:** Confirm the assumed endpoints (`/api/modules`, `/api/modules/{slug}`, `/api/modules/{slug}/apply-patch`, `/api/presets`, `/api/projects`, `/api/modules-landscape`) against the running seed4j, and record the verified contract.
- **Why:** CLAUDE.md flags these as inherited-from-JHipster-Lite and "verify before assuming stable" — drift here breaks every tool.
- **Where:** docs + comments in [src/client.ts](../src/client.ts).
- **Done when:** Each endpoint's request/response shape is documented and matches a live seed4j; any divergence is fixed.

### 16. CI: typecheck + test on PRs, and lint
- **What:** Ensure `ci.yml` runs `npm run typecheck` and `npm test` on every PR; add a linter/formatter (ESLint + Prettier) if not already enforced.
- **Why:** Locks in the quality gates that already exist locally and keeps style consistent as contributors arrive.
- **Where:** `.github/workflows/ci.yml`, new lint config.
- **Done when:** PRs are blocked on failing typecheck/tests/lint.

---

## Lifecycle management

### 17. Remove an applied module and its files
- **What:** Add a `remove_module` tool that reverses a previously-applied module: it computes the set of files seed4j installed for that module, returns a preview by default (paths to be deleted, plus any file that has been locally modified since install — typically business code added on top of the scaffold), and only deletes when called with an explicit `confirm: true`. On confirmation it removes those files, leaves any locally-modified file untouched unless `force: true` is set, and updates the project's applied-modules history so the module no longer appears in `get_project_status`. Mirrors the "apply" surface: input is `{ projectFolder, moduleSlug, confirm?, force? }`.
- **Why:** Today a wrong module choice or an obsolete dependency has no clean undo. Developers end up reverting manually or starting the project from scratch. Exposing a scripted removal lets a dev tell the agent "drop module X" when it doesn't match expectations or is no longer used — and **forces the agent to surface the destructive intent before acting**, because the preview will flag any business code that lives inside the files seed4j scaffolded.
- **Where:** [src/client.ts](../src/client.ts) (new methods: list the files an applied module touched, detect locally-modified files, delete + update the applied-modules record), [src/tools.ts](../src/tools.ts) (new tool with the preview-then-confirm shape), [tests/](../tests/) (clean removal, removal with user-modified files, no-op when the module isn't applied, refusal when `confirm` is missing). Depends on seed4j either exposing an "undo" / file-manifest endpoint or on the MCP server reconstructing the file list from the applied-modules record in the project folder — verify the live seed4j API before building.
- **Done when:** Calling `remove_module` without `confirm: true` returns a structured preview (`{ filesToDelete, locallyModifiedFiles }`) and does **not** mutate disk; calling with `confirm: true` deletes only files whose content still matches the original install, refuses to touch locally-modified files unless `force: true` is set, and removes the module from the project's history so `get_project_status` reflects the change; behaviour is unit-tested for all three branches (preview, clean remove, modified-file refusal).

---

## Notes
- **Stack:** Node 20+ / TypeScript (ESM) using `@modelcontextprotocol/sdk` over STDIO + `zod` + native `fetch`. (Anything referring to a "Spring AI" implementation is stale — this is the TypeScript server.)
- **Golden rule:** never write to stdout from anywhere but the MCP transport — it corrupts the framing and hangs the client.
- When a feature here depends on a seed4j capability (e.g. #9 preview, #7 enum schema), verify the live API before building.
