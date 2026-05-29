# Prompts

MCP defines a third primitive — **prompts** — for parametrised prompt templates that clients and host applications can surface (typically as slash-style starters or reusable workflow starters). The user picks a prompt, fills in the arguments, and the server returns a structured message sequence for the assistant, agent, or model-backed workflow to use as starting context.

This server registers two prompts, one per documented seed4j flow:

| Prompt name            | Flow                                                                                              | Arguments                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `seed4j-curated-stack` | `list_presets → get_preset_details → preview_module → apply_preset`                               | `stackDescription` (required), `projectFolder` (optional) |
| `seed4j-custom-stack`  | `search_modules → get_module_dependencies → validate_properties → preview_module → apply_modules` | `stackDescription` (required), `projectFolder` (optional) |

## Arguments

Both prompts accept the same two arguments:

| Name               | Required | Description                                                                                                                               |
| ------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `stackDescription` | yes      | What the user wants to build, in their own words (e.g. `"Java library with Maven"`).                                                      |
| `projectFolder`    | no       | Absolute path to the target project folder. Leave empty when the user hasn't decided yet — the prompt explicitly tells the caller to ask. |

## `seed4j-curated-stack`

Use this when the user wants a curated, pre-ordered stack from the seed4j preset catalogue (the typical "give me a sensible default" case).

The returned message tells the assistant, agent, or host workflow to:

1. Call `list_presets` (or read [`seed4j://catalogue/presets`](resources.md)) to fetch the curated catalogue.
2. Pick the preset whose modules best match the description. Ask the user if two presets fit — never guess.
3. Call `get_preset_details` to confirm the chosen preset's module list and required properties.
4. Call `preview_module` for the preset's first module to show the user a concrete file-level plan. **Do not skip this step.**
5. After the user confirms, call `apply_preset` with `commit: true` for a clean per-module git history.
6. Confirm success with `get_project_status`.
7. On any unexpected error, run `ping_seed4j` first to rule out connectivity.

## `seed4j-custom-stack`

Use this when the user wants a stack built from individual modules — no preset matches, or they want fine-grained control over each piece.

The returned message tells the assistant, agent, or host workflow to:

1. Call `search_modules` with terms from the description to find candidate modules.
2. For each module, call `get_module_dependencies` to get prerequisites in topological order and any `featureChoices` needing disambiguation.
3. When `featureChoices` is non-empty (e.g. choosing one datasource flavour), **stop and ask the user** — do not pick on their behalf.
4. Call `validate_properties` on every module to surface missing/mistyped inputs and which defaults will apply.
5. Call `preview_module` for the first module so the user sees a concrete file-level plan before any mutation.
6. After confirmation, call `apply_modules` with the ordered steps (prerequisites first, target module last) and `commit: true`.
7. Confirm success with `get_project_status`.
8. On any unexpected error, run `ping_seed4j` first.

## When to use a prompt vs. free-form instructions

- **Prompts encode order.** A fresh assistant, agent, or automation flow that doesn't know seed4j won't accidentally call `apply_module` before `get_module_dependencies` — the prompt lists the steps in the right sequence.
- **Prompts surface the on-ramp to humans.** Slash-style pickers and workflow menus (Claude Desktop, IDE plugins, custom MCP clients) show prompts as named entry points: a user sees `/seed4j-curated-stack` and immediately knows where to start.
- **Prompts don't execute tools.** They only return text. Tool execution remains the caller's job; the prompt just provides the order.

## What's not a prompt

- **Removal flow.** The `remove_module` tool exists, but there is no dedicated `seed4j-remove-module` prompt yet. The tool's preview-first contract is documented in [tools.md](tools.md#remove_module).
- **Bootstrap-from-scratch** combining preset + custom paths. Today the two prompts cover both cases; a caller that's unsure should ask the user which flow to take.
- **Localisation.** English-only.
