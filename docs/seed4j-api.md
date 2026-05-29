# seed4j HTTP API (verified contract)

This page pins down every seed4j endpoint, query param, request body field, and response field this MCP server depends on — verified against the [seed4j repository](https://github.com/seed4j/seed4j) source. When seed4j ships a new release, re-run [`scripts/verify-seed4j-api.ts`](../scripts/verify-seed4j-api.ts) (`npm run verify:api`) to confirm the contract still holds.

- **Last verified:** 2026-05-29 against the seed4j `main` branch (HEAD at fetch time).
- **Verification method:** WebFetch of the seed4j Java sources in `src/main/java/com/seed4j/.../infrastructure/primary/`. Citations are inline per endpoint.
- **Runtime verification:** [`scripts/verify-seed4j-api.ts`](../scripts/verify-seed4j-api.ts) — operator points it at a live seed4j (`SEED4J_BASE_URL`), gets a pass/fail per endpoint.

## Conventions

- Every endpoint serves `application/json` unless noted.
- Authentication is whatever the deployment requires; if `SEED4J_AUTH_HEADER` (or `SEED4J_BEARER_TOKEN`) is set, we send `Authorization: <value>` on every call.
- Field types use `string | null` for "present, may be null" and `string?` for "may be absent".

## Endpoints

### `GET /api/modules`

The full module catalogue, grouped by category.

**Source:** [`ModulesResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/module/infrastructure/primary/ModulesResource.java) → `RestSeed4JModules`, `RestSeed4JModuleCategory`, `RestSeed4JModule`.

**Response (200):**

```jsonc
{
  "categories": [
    {
      "name": "string", // category label (e.g. "Build")
      "modules": [
        {
          "slug": "string", // unique module identifier (e.g. "maven-java")
          "description": "string",
          "properties": {
            /* RestSeed4JModulePropertiesDefinition — see GET /api/modules/{slug} */
          },
          "tags": ["string"],
        },
      ],
    },
  ],
}
```

**Consumed by:** `list_modules`, `search_modules`, `ping_seed4j` (liveness probe), resource `seed4j://catalogue/modules`.
**Fields we read:** `categories[].name`, `categories[].modules[].slug` / `.description` / `.tags`. We ignore the per-module `properties` block here (the dedicated GET surfaces the same data).

### `GET /api/modules/{slug}`

The property-definition schema for one module.

**Source:** [`ModulesResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/module/infrastructure/primary/ModulesResource.java) → `RestSeed4JModulePropertiesDefinition` → `RestSeed4JModulePropertyDefinition`.

**Path params:** `slug` (URL-encoded).

**Response (200):**

```jsonc
{
  "definitions": [
    {
      "key": "string",           // property name, e.g. "packageName"
      "type": "STRING" | "INTEGER" | "BOOLEAN" | "ENUM",
      "mandatory": true,
      "description": "string?",
      "defaultValue": "string?", // serialised as String even for INTEGER / BOOLEAN
      "order": 0
    }
  ]
}
```

**Consumed by:** `get_module_details`, `validate_properties`.
**Fields we read:** `definitions[].key` / `.type` / `.mandatory` / `.defaultValue`.

**Known gaps (seed4j-side, not ours):**

- **No `enumValues` (or `values` / `acceptableValues`) field.** Allowed values for `ENUM` properties are **not exposed** in this response. Our defensive read in [`src/client.ts`](../src/client.ts) (`readEnumValues`) covers three possible spellings, so the moment seed4j surfaces them, validation activates with no further code change.
- **No `pattern` field.** Regex constraints (e.g. for `packageName`) aren't exposed. Our `readPattern` is defensive in the same way.
- **No top-level `default`.** Only `defaultValue`. We defensively read both; only one is hit.

These gaps are why [`docs/tools.md`](tools.md#validate_properties) describes ENUM / pattern validation as "ready" — the code is in place but won't fire against today's seed4j payload.

### `POST /api/modules/{slug}/apply-patch`

Apply a single module to a project folder.

**Source:** [`ModulesResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/module/infrastructure/primary/ModulesResource.java) → `RestSeed4JModuleProperties` (request body).

**Path params:** `slug` (URL-encoded).

**Request body:**

```jsonc
{
  "projectFolder": "string", // required, absolute path
  "commit": true, // required, boolean (git commit after apply)
  "parameters": {
    /* Map<String, Object> */
  },
}
```

**Response (2xx):** void / empty body.

**Consumed by:** `apply_module`, `apply_modules`, `apply_preset`, `create_project`, `preview_module`.
**Fields we send:** `projectFolder`, `commit`, `parameters` — exactly the three required by seed4j.

### `GET /api/presets`

The curated, pre-ordered preset catalogue.

**Source:** [`ModulesResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/module/infrastructure/primary/ModulesResource.java) → `RestPresets` → `RestPreset` → `RestModuleToApply`.

**Response (200):**

```jsonc
{
  "presets": [
    {
      "name": "string", // preset display name (e.g. "Java Library with Maven")
      "modules": [
        { "slug": "string" }, // ordered list of module slugs to apply
      ],
    },
  ],
}
```

**Consumed by:** `list_presets`, `get_preset_details`, `apply_preset`, resource `seed4j://catalogue/presets`.
**Fields we read:** `presets[].name`, `presets[].modules[].slug`.

### `GET /api/modules-landscape`

The dependency-ranked module landscape.

**Source:** [`ModulesResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/module/infrastructure/primary/ModulesResource.java) → `RestSeed4JLandscape` → `RestSeed4JLandscapeLevel` → `RestSeed4JLandscapeElement` (sealed: `RestSeed4JLandscapeModule` or `RestSeed4JLandscapeFeature`).

**Response (200):**

```jsonc
{
  "levels": [
    {
      "elements": [
        // type === "MODULE"
        {
          "type": "MODULE",
          "slug": "string",
          "operation": "string",      // e.g. "APPLY"
          "properties": { /* RestSeed4JModulePropertiesDefinition */ },
          "rank": "string",           // e.g. "RANK_S" / "RANK_A" / "RANK_B"
          "dependencies": [
            { "type": "MODULE" | "FEATURE", "slug": "string" }
          ]
        },

        // type === "FEATURE"
        {
          "type": "FEATURE",
          "slug": "string",
          "modules": [ /* same shape as the MODULE element above */ ]
        }
      ]
    }
  ]
}
```

**Consumed by:** `get_module_dependencies`, resource `seed4j://catalogue/landscape`.
**Fields we read:** `levels[].elements[].type` / `.slug` / `.operation` / `.rank` / `.dependencies[].type` / `.dependencies[].slug`; for FEATURE elements `levels[].elements[].modules[]`. We ignore `properties` (unused today; available for future tooling).

### `GET /api/projects`

The seed4j history of a project folder.

**Source:** [`ProjectsResource.java`](https://github.com/seed4j/seed4j/blob/main/src/main/java/com/seed4j/project/infrastructure/primary/ProjectsResource.java) → `RestProjectHistory` → `RestAppliedModule`.

**Query params:** `path` (String, required) — absolute path to the project folder.

**Response (200):**

```jsonc
{
  "modules": [
    { "slug": "string" }, // applied modules, oldest first
  ],
  "properties": {
    /* Map<String, Object> — aggregated properties used during apply */
  },
}
```

**Important:** the array is `modules`, **not** `appliedModules`. Each entry has **only** `slug` — no timestamp, no per-module properties. Property history is aggregated at the top level only.

**Note:** the same path `GET /api/projects` also serves a **binary octet-stream** when `Accept` requests it (project zip download). The client always sends `Accept: application/json`, which routes to the JSON branch above.

**Consumed by:** `get_project_status`.
**Fields we read:** none — the body is forwarded as-is to the MCP agent.

### `GET /management/info`

Spring Boot Actuator info endpoint. Used by `ping_seed4j` as a best-effort version probe.

**Source:** [`application.yml`](https://github.com/seed4j/seed4j/blob/main/src/main/resources/config/application.yml) — `management.endpoints.web.exposure.include` lists `info`; `management.info.git.mode: full` and `management.info.env.enabled: true` are set.

**Response (200):** Spring Boot Actuator standard shape. Typically:

```jsonc
{
  "git": {
    "branch": "string",
    "commit": { "id": "string", "time": "string" },
  },
  "build": {
    "artifact": "string",
    "name": "string",
    "version": "string", // ping_seed4j extracts this (best-effort)
  },
}
```

**Consumed by:** `ping_seed4j` (version probe only — liveness uses `/api/modules`).
**Fields we read:** `build.version` (preferred) or top-level `version` (fallback). Either may be absent; `version` in the ping payload falls back to `null` without failing the probe.

## Endpoints we don't use

| Endpoint                  | Why we don't use it                                                                                                                                                                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/apply-patches` | Bulk apply: takes a `RestSeed4JModulesToApply` body and applies several modules in one call. We sequence per-module calls via `apply_modules` so we can report mid-sequence failures and which slugs remain. Switching to bulk would lose that granularity. |

## Re-verifying the contract

Run [`scripts/verify-seed4j-api.ts`](../scripts/verify-seed4j-api.ts) against a live seed4j:

```bash
SEED4J_BASE_URL=http://localhost:1339 npm run verify:api
```

The script hits each endpoint, asserts the shape, and prints a pass/fail per check. Exit code is non-zero on any failure. Bump the **Last verified** date in this file after a clean run.
