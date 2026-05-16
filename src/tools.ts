import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Seed4jClient } from "./client.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

const propertiesSchema = z
  .record(z.string(), z.unknown())
  .describe("Module-specific properties as a JSON object, e.g. {\"packageName\":\"com.example.app\",\"baseName\":\"myapp\"}.");

const optionalPropertiesSchema = propertiesSchema
  .optional()
  .describe("Module-specific properties as a JSON object. Omit when the module has no required properties.");

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

export function buildTools(client: Seed4jClient): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "list_modules",
      description:
        "List all available seed4j modules grouped by category. Returns JSON describing every module the seed4j server can apply.",
      inputSchema: {},
      handler: async () => text(await client.listModules()),
    },
    {
      name: "get_module_details",
      description:
        "Return the property definitions (mandatory/optional inputs, defaults, types) for a seed4j module. Use this to learn which parameters apply_module needs. For prerequisite ordering, call get_module_dependencies instead.",
      inputSchema: {
        moduleSlug: z
          .string()
          .describe("Slug identifier of the seed4j module (e.g. 'spring-boot', 'jpa-postgresql')."),
      },
      handler: async ({ moduleSlug }) => text(await client.getModuleDetails(moduleSlug)),
    },
    {
      name: "get_module_dependencies",
      description:
        "Return the prerequisite graph for a seed4j module: an 'applicationOrder' list of module slugs to apply before this one (topologically ordered), the module's direct dependencies, and any 'featureChoices' the caller must pick from (e.g. choosing one datasource flavor). Use this before apply_module to assemble a coherent stack.",
      inputSchema: {
        moduleSlug: z.string().describe("Slug identifier of the target seed4j module."),
      },
      handler: async ({ moduleSlug }) => text(await client.getModuleDependencies(moduleSlug)),
    },
    {
      name: "list_presets",
      description:
        "List curated seed4j presets (named, pre-ordered stacks like 'Webapp: Vue + Spring Boot'). Each preset is a sequence of module slugs to apply in order. Prefer offering a matching preset when a user requests a common stack.",
      inputSchema: {},
      handler: async () => text(await client.listPresets()),
    },
    {
      name: "get_preset_details",
      description:
        "Return a single preset by its display name (case-insensitive): the ordered list of module slugs it applies. Use this after list_presets to commit to one preset without re-fetching the full catalogue.",
      inputSchema: {
        presetName: z
          .string()
          .describe("Preset name as shown by list_presets, e.g. 'Java Library with Maven'."),
      },
      handler: async ({ presetName }) => text(await client.getPresetDetails(presetName)),
    },
    {
      name: "search_modules",
      description:
        "Keyword search across all seed4j modules. Returns the highest-scoring matches by slug, description, tags, and category (case-insensitive substring scoring, slug weighted highest). Use this to narrow the catalogue before calling get_module_details or get_module_dependencies.",
      inputSchema: {
        query: z
          .string()
          .describe("Free-text query. Multiple terms are scored independently and summed."),
        limit: z
          .number()
          .int()
          .optional()
          .describe("Maximum number of matches to return. Defaults to 20 if omitted or non-positive."),
      },
      handler: async ({ query, limit }) => text(await client.searchModules(query, limit ?? 0)),
    },
    {
      name: "get_project_status",
      description:
        "Return the seed4j history of a project folder: the ordered list of applied module slugs and the aggregated properties used. Call this to discover what is already wired before suggesting next modules.",
      inputSchema: {
        projectFolder: z.string().describe("Absolute path to an existing seed4j project folder."),
      },
      handler: async ({ projectFolder }) => text(await client.getProjectStatus(projectFolder)),
    },
    {
      name: "apply_module",
      description:
        "Apply a seed4j module to an existing project folder. Use list_modules to discover slugs and get_module_details to learn which properties are required.",
      inputSchema: {
        moduleSlug: z.string().describe("Slug identifier of the seed4j module to apply."),
        projectFolder: z
          .string()
          .describe("Absolute path to the existing project folder to mutate."),
        properties: optionalPropertiesSchema,
      },
      handler: async ({ moduleSlug, projectFolder, properties }) =>
        text(await client.applyModule(moduleSlug, projectFolder, properties ?? {})),
    },
    {
      name: "create_project",
      description:
        "Initialise a new base seed4j project at the given folder. After this, use apply_module to add features (build tool, framework, persistence, etc.).",
      inputSchema: {
        projectFolder: z
          .string()
          .describe(
            "Absolute path where the project will be created. The folder will be created if it does not exist.",
          ),
        properties: propertiesSchema.describe(
          "Base project properties as a JSON object, e.g. {\"projectName\":\"My App\",\"baseName\":\"myapp\",\"nodePackageManager\":\"npm\"}.",
        ),
      },
      handler: async ({ projectFolder, properties }) =>
        text(await client.createProject(projectFolder, properties)),
    },
    {
      name: "validate_properties",
      description:
        "Dry-run check of a property map against a module's schema (mandatory keys present, types match STRING/INTEGER/BOOLEAN, no unknown keys). Returns {valid, errors, warnings}. Run this before apply_module to surface missing or mistyped inputs without mutating the project.",
      inputSchema: {
        moduleSlug: z
          .string()
          .describe("Slug identifier of the seed4j module whose schema will be checked."),
        properties: propertiesSchema.describe(
          "Properties to validate as a JSON object, e.g. {\"packageName\":\"com.example.app\"}.",
        ),
      },
      handler: async ({ moduleSlug, properties }) =>
        text(await client.validateProperties(moduleSlug, properties)),
    },
    {
      name: "apply_modules",
      description:
        "Apply an ordered list of modules to the same project folder in one call, stopping at the first failure. Pass the steps as an array of {slug, properties} objects in the order returned by get_module_dependencies. Returns {appliedCount, applied, failure, remaining}.",
      inputSchema: {
        projectFolder: z
          .string()
          .describe("Absolute path to the existing project folder to mutate."),
        steps: z
          .array(
            z.object({
              slug: z.string().describe("Slug identifier of the module to apply."),
              properties: z
                .record(z.string(), z.unknown())
                .optional()
                .describe("Properties for this module."),
            }),
          )
          .describe(
            "Ordered steps, e.g. [{\"slug\":\"maven-java\",\"properties\":{}},{\"slug\":\"java-base\",\"properties\":{\"packageName\":\"com.example.app\"}}].",
          ),
      },
      handler: async ({ projectFolder, steps }) =>
        text(await client.applyModules(projectFolder, steps)),
    },
    {
      name: "apply_preset",
      description:
        "Resolve a preset by name and apply every module in its order to the given project folder, sharing one property map across all modules. Stops at the first failure. Use this instead of apply_module when the user wants a curated stack from list_presets.",
      inputSchema: {
        presetName: z
          .string()
          .describe("Preset name as shown by list_presets, e.g. 'Java Library with Maven'."),
        projectFolder: z
          .string()
          .describe("Absolute path to the existing project folder to mutate."),
        properties: propertiesSchema.describe(
          "Shared properties for every module in the preset, e.g. {\"projectName\":\"My App\",\"baseName\":\"myapp\",\"packageName\":\"com.example.app\"}.",
        ),
      },
      handler: async ({ presetName, projectFolder, properties }) =>
        text(await client.applyPreset(presetName, projectFolder, properties)),
    },
  ];
  return tools;
}

export function registerTools(server: McpServer, client: Seed4jClient): void {
  for (const tool of buildTools(client)) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.inputSchema },
      tool.handler as Parameters<McpServer["registerTool"]>[2],
    );
  }
}
