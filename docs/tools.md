# Tools

Every tool returns the raw JSON body from seed4j wrapped in `{ content: [{ type: "text", text }] }`, unless noted otherwise. Tool descriptions seen by the agent are the source of truth — this page mirrors them for human readers.

## Connectivity

### `ping_seed4j`

- **Input:** `timeoutMs?: number` (positive integer; default 5000).
- **Behaviour:** fires `GET /api/modules` (liveness) and `GET /management/info` (version, best-effort) in parallel, bypassing the catalogue cache and the retry layer so the result reflects current connectivity. Latency is measured around the liveness probe.
- **Output:**
  ```json
  {
    "reachable": true, // got an HTTP response within the timeout
    "ok": true, // liveness returned 2xx
    "baseUrl": "...", // resolved SEED4J_BASE_URL
    "endpoint": "/api/modules",
    "status": 200, // null when reachable: false
    "latencyMs": 47,
    "version": "1.2.3", // null when /management/info is missing or doesn't expose a version
    "checkedAt": "2026-05-28T22:30:00.000Z",
    "error": "..." // only present when reachable: false
  }
  ```
- **When to use:** on startup to confirm wiring, before a long apply plan, or when another tool returns an unexpected error and the agent needs to know whether seed4j is even up.

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

### `preview_module`

- **Input:** `moduleSlug: string`, `projectFolder: string`, `properties?: Record<string, unknown>`.
- **Behaviour:** dry-run the module against a scratch copy of the project folder and report the file-level diff — **never** mutates the real project. Internally: copies `projectFolder` to a scratch directory (or starts empty when the folder doesn't exist), applies the module there with `commit: false`, walks the result, compares to the original byte-for-byte, and removes the scratch directory in a `finally`. Auto-selects mode:
  - **`copy`** when `projectFolder` exists — the diff is against the project's current contents.
  - **`empty`** when `projectFolder` doesn't exist — useful for previewing `init` (and other base modules) before `create_project`.
- **Output:**

  ```json
  {
    "mode": "copy",
    "moduleSlug": "maven-java",
    "projectFolder": "/Users/.../myapp",
    "changedFilesCount": 2,
    "changes": [
      { "path": "pom.xml", "kind": "modified", "sizeBytes": 3204, "previousSizeBytes": 1800 },
      { "path": "src/main/java/Foo.java", "kind": "added", "sizeBytes": 250 }
    ]
  }
  ```

  - `kind` is one of `added` / `modified` / `deleted`. Files are compared by exact byte equality (no hashing).
  - `sizeBytes` is the post-apply size; `modified` entries also carry `previousSizeBytes`. `deleted` entries have `sizeBytes: 0` and `previousSizeBytes`.
  - `changes` is sorted alphabetically by `path` for stable output.
  - `.git/` directories are excluded from both sides of the diff (seed4j may auto-init git; the noise would dominate).

- **Constraints:** the MCP server and seed4j must share a filesystem (same constraint as `apply_module` — seed4j needs to write to the scratch path). Disk required ≈ project size. Calls are non-cached and non-retried — preview always reflects the latest state.
- **When to use:** pair with `validate_properties` before `apply_module` so the agent can show the user a concrete file-by-file plan instead of describing it. Recommended sequence: `validate_properties → preview_module → user confirms → apply_module`.

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

### `remove_module`

- **Input:** `moduleSlug: string`, `projectFolder: string`, `confirm?: boolean` (default `false`), `force?: boolean` (default `false`).
- **Behaviour:** removes a previously-applied module by reading the project's [`.seed4j/modules/history.json`](seed4j-api.md#seed4jmoduleshistoryjson), replaying the history twice into scratch dirs — with the target and without — using each action's **own** properties, and diffing both against the current project folder. Classifies each touched file as **clean** (current bytes match the install snapshot) or **locally-modified** (current bytes differ — typically business code the user added on top of the scaffold). With `confirm: true`, deletes clean added files, reverts clean modified files to their pre-install content, skips locally-modified files (unless `force: true`), and writes `.seed4j/modules/history.json` back atomically with the targeted action removed. Cost: ~2 × N apply-patch calls, where N is the number of applied modules. `.git/` and `.seed4j/` are excluded from the diff on every side.
- **Output (preview, default):**
  ```json
  {
    "moduleSlug": "maven-java",
    "projectFolder": "/Users/.../app",
    "action": "preview",
    "actionIndex": 1,
    "modulesReplayed": 1,
    "filesToDelete": [{ "path": "pom.xml", "sizeBytes": 1800 }],
    "filesToRevert": [{ "path": ".gitignore", "currentSizeBytes": 200, "revertedSizeBytes": 100 }],
    "locallyModifiedFiles": [
      {
        "path": "src/main/java/com/example/App.java",
        "kind": "added",
        "currentSizeBytes": 1200,
        "installedSizeBytes": 250
      }
    ],
    "historyUpdate": { "currentActions": 2, "afterRemoval": 1 }
  }
  ```
- **Output (`confirm: true`):**
  ```json
  {
    "moduleSlug": "maven-java",
    "projectFolder": "/Users/.../app",
    "action": "removed",
    "actionIndex": 1,
    "deletedCount": 1,
    "deleted": ["pom.xml"],
    "revertedCount": 1,
    "reverted": [".gitignore"],
    "skippedLocallyModifiedCount": 1,
    "skippedLocallyModified": ["src/main/java/com/example/App.java"],
    "historyUpdated": true
  }
  ```
- **Output (slug not in history):** `{ "action": "not-applied", ... }`.
- **Multiple applications:** if the same slug was applied more than once, this call removes the **most recent** occurrence (`actionIndex` reports which).
- **When to use:** when the user wants to undo a wrong or obsolete module choice. **Surface the preview's `locallyModifiedFiles` list to the user before flipping `confirm: true`** — those are the files that will be skipped (default) or destroyed (`force: true`). Pair with `get_project_status` after removal to confirm the history reflects the change.
- **Constraints:** the MCP server and seed4j must share a filesystem (same constraint as `apply_module` — replays write to scratch dirs seed4j must be able to mutate). Disk required ≈ 2 × project size. Calls are non-cached and non-retried — removal always reflects the latest state.

## MCP resources

The module catalogue, landscape, and preset list are **also** exposed as MCP resources — see [resources.md](resources.md). The tools above remain the right choice for inline / per-turn use; resources are for browsing and one-shot attachment.

## MCP prompts

The two documented seed4j flows (curated stack, custom stack) are exposed as MCP prompts — see [prompts.md](prompts.md). Prompts encode the tool order so the agent doesn't have to infer it.

## Not yet exposed

_All roadmap items shipped._
