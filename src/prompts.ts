import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export interface PromptMessage {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
}

export interface PromptResult {
  messages: PromptMessage[];
}

interface PromptArgs {
  stackDescription: string;
  projectFolder?: string;
}

export interface PromptDefinition {
  name: string;
  description: string;
  argsSchema: {
    stackDescription: z.ZodString;
    projectFolder: z.ZodOptional<z.ZodString>;
  };
  handler: (args: PromptArgs) => PromptResult;
}

const sharedArgsSchema = {
  stackDescription: z
    .string()
    .min(1)
    .describe("What the user wants to build, in their own words (e.g. 'Java library with Maven')."),
  projectFolder: z
    .string()
    .optional()
    .describe(
      "Absolute path to the project folder. Leave empty if the user hasn't decided yet — the agent will ask.",
    ),
};

export function buildPrompts(): PromptDefinition[] {
  return [
    {
      name: "seed4j-curated-stack",
      description:
        "Scaffold a seed4j project using one of the curated presets. Encodes the list_presets → get_preset_details → preview_module → apply_preset flow so the agent picks the right preset and shows the user a plan before mutating disk.",
      argsSchema: sharedArgsSchema,
      handler: (args) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: buildCuratedStackText(args) },
          },
        ],
      }),
    },
    {
      name: "seed4j-custom-stack",
      description:
        "Scaffold a seed4j project from individual modules (no preset). Encodes the search_modules → get_module_dependencies → validate_properties → preview_module → apply_modules flow so the agent assembles a coherent stack and stops to ask the user when feature choices need disambiguation.",
      argsSchema: sharedArgsSchema,
      handler: (args) => ({
        messages: [
          {
            role: "user",
            content: { type: "text", text: buildCustomStackText(args) },
          },
        ],
      }),
    },
  ];
}

function buildCuratedStackText(args: PromptArgs): string {
  const folderLine = args.projectFolder
    ? `Target project folder: ${args.projectFolder}`
    : "Target project folder: (not yet decided — ask the user before any apply step)";
  return [
    "You are helping the user scaffold a seed4j project using a curated preset.",
    "",
    `User's stack description: "${args.stackDescription}"`,
    folderLine,
    "",
    "Follow this flow exactly:",
    "",
    "1. Call `list_presets` to fetch the curated catalogue (or read the seed4j://catalogue/presets resource).",
    "2. Pick the preset whose modules best match the description. If two presets fit, ask the user which one — do not guess.",
    "3. Call `get_preset_details` on the chosen preset to confirm its module list and required properties.",
    "4. Call `preview_module` for the preset's first module to show the user what the scaffold will produce. Do not skip this step.",
    "5. After the user confirms, call `apply_preset` with `commit: true` for a clean per-module git history.",
    "6. Confirm success with `get_project_status` and surface the applied module list.",
    "",
    "If any tool returns an unexpected error, run `ping_seed4j` first to rule out connectivity, then surface the error to the user.",
  ].join("\n");
}

function buildCustomStackText(args: PromptArgs): string {
  const folderLine = args.projectFolder
    ? `Target project folder: ${args.projectFolder}`
    : "Target project folder: (not yet decided — ask the user before any apply step)";
  return [
    "You are helping the user assemble a custom seed4j stack from individual modules.",
    "",
    `User's stack description: "${args.stackDescription}"`,
    folderLine,
    "",
    "Follow this flow exactly:",
    "",
    "1. Call `search_modules` with terms drawn from the description to find candidate modules.",
    "2. For each module you intend to include, call `get_module_dependencies` to get its prerequisites in topological order and any `featureChoices` the caller must disambiguate.",
    "3. When `featureChoices` is non-empty (e.g. choosing one datasource flavour), stop and ask the user — do not pick on their behalf.",
    "4. Call `validate_properties` on every module to surface missing or mistyped inputs, and to see which schema defaults will kick in.",
    "5. Call `preview_module` for the first module so the user can see a concrete file-level plan before any mutation.",
    "6. After the user confirms, call `apply_modules` with the ordered steps (prerequisites first, target module last) and `commit: true` for a clean per-module git history.",
    "7. Confirm success with `get_project_status` and surface the applied module list.",
    "",
    "If any tool returns an unexpected error, run `ping_seed4j` first to rule out connectivity, then surface the error to the user.",
  ].join("\n");
}

export function registerPrompts(server: McpServer): void {
  for (const prompt of buildPrompts()) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description, argsSchema: prompt.argsSchema },
      prompt.handler as unknown as Parameters<McpServer["registerPrompt"]>[2],
    );
  }
}
