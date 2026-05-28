# Changelog

User-visible deltas as [ROADMAP.md](ROADMAP.md) items land. The roadmap is the source of truth for **what** is planned; this file records **what shipped**, with the per-item user impact.

## Unreleased

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
