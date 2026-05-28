# Tools

Every tool returns the raw JSON body from seed4j wrapped in `{ content: [{ type: "text", text }] }`, unless noted otherwise. Tool descriptions seen by the agent are the source of truth — this page mirrors them for human readers.

## Catalogue

### `list_modules`
- **Input:** none.
- **Output:** the full seed4j module catalogue, grouped by category.
- **When to use:** broad discovery. Prefer `search_modules` once the user's intent is narrower.

### `search_modules`
- **Input:** `query: string`, `limit?: number` (default 20).
- **Output:** `{ query, matches: [{ slug, description, tags, category, score }] }` — case-insensitive substring scoring across slug (×3), description (×2), tags and category (×1), sorted by score desc.
- **When to use:** narrow the catalogue before `get_module_details` / `get_module_dependencies`.

### `get_module_details`
- **Input:** `moduleSlug: string`.
- **Output:** module schema — property `definitions` (key, type, mandatory, default…) plus seed4j metadata.
- **When to use:** to learn which properties `apply_module` needs.

### `get_module_dependencies`
- **Input:** `moduleSlug: string`.
- **Output:** `{ slug, operation, rank, directDependencies, applicationOrder, featureChoices }` derived from `/api/modules-landscape`. `applicationOrder` is a topologically-ordered list of slugs to apply **before** the target. `featureChoices` maps each FEATURE dependency to the candidate module slugs.
- **When to use:** before assembling a multi-step apply plan.

### `list_presets`
- **Input:** none.
- **Output:** the curated presets catalogue (named, pre-ordered stacks).

### `get_preset_details`
- **Input:** `presetName: string` (case-insensitive).
- **Output:** the matched preset object (name + ordered module list).
- **Errors:** throws if no preset matches.

## Project state

### `get_project_status`
- **Input:** `projectFolder: string` (absolute path).
- **Output:** seed4j's record of what has been applied to that folder and the aggregated properties.

### `validate_properties`
- **Input:** `moduleSlug: string`, `properties: Record<string, unknown>`.
- **Output:** `{ slug, valid, errors, warnings, defaultsApplied }`.
  - **Type checks:** `STRING` (any string), `INTEGER` (number or numeric string), `BOOLEAN`, and `ENUM` (value must appear in the schema's `enumValues` / `values` / `acceptableValues` list — first present wins).
  - **Pattern check:** when a definition declares a `pattern`, the value (stringified) must match the regex. An unparseable pattern is silently skipped — no false errors.
  - **Errors:** type mismatches, ENUM violations (with the allowed set inlined), pattern violations (with the pattern source inlined), and **mandatory keys missing with no declared default**.
  - **Warnings:** properties the caller supplied that aren't declared in the schema.
  - **`defaultsApplied`:** keys the caller didn't supply but the schema declares a default for (`defaultValue` or `default`). A mandatory key in this state is **not** an error — seed4j will fall back to the default at apply time. Each entry is `{ key, default }`.
- **When to use:** dry-run before `apply_module` to surface mistyped, missing, or constraint-violating inputs without mutating the project — and to find out which defaults will kick in.

## Project mutation (writes)

### `create_project`
- **Input:** `projectFolder: string`, `properties: Record<string, unknown>`, `commit?: boolean` (default `false`).
- **Behaviour:** `mkdir -p` the folder, then `apply_module("init", folder, properties, commit)`.
- **Output:** the seed4j apply-patch response for `init`.

### `apply_module`
- **Input:** `moduleSlug: string`, `projectFolder: string`, `properties?: Record<string, unknown>`, `commit?: boolean` (default `false`).
- **Behaviour:** POST `/api/modules/{slug}/apply-patch` with `{ projectFolder, commit, parameters }`. When `commit: true`, seed4j runs `git commit` after applying the patch — one commit per module.
- **Output:** the raw apply-patch response.

### `apply_modules`
- **Input:** `projectFolder: string`, `steps: [{ slug, properties? }]`, `commit?: boolean` (default `false`).
- **Behaviour:** apply each step in order, stopping at the first failure. `commit` is applied uniformly to every step in the batch.
- **Output:** `{ projectFolder, appliedCount, applied, failure, remaining }`.

### `apply_preset`
- **Input:** `presetName: string`, `projectFolder: string`, `properties: Record<string, unknown>`, `commit?: boolean` (default `false`).
- **Behaviour:** resolve the preset, then apply every module in order with the **same** shared properties. `commit` is applied uniformly to every module in the preset (one commit per module when `true`).
- **Output:** identical shape to `apply_modules`.

#### When to set `commit: true`

Set `commit: true` when scaffolding a project end-to-end and the caller wants a **clean per-feature git history** (one commit per applied module — easy to bisect, easy to revert one step). Keep the default `false` for speculative or validation runs, where rolling back is simpler without intermediate commits. Per-step `commit` overrides inside `apply_modules` / `apply_preset` are not exposed — the flag is a single top-level choice.

## Not yet exposed

- Health/ping tool (roadmap item 8).
- Module apply preview/dry-run (roadmap item 9).
- MCP resources (roadmap item 10) and prompts (roadmap item 11).
