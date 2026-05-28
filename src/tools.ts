import { z, type ZodRawShape } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { HttpError, TimeoutError, type Seed4jClient } from "./client.js";

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ToolDefinition<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  inputSchema: Shape;
  handler: (input: z.infer<z.ZodObject<Shape>>) => Promise<ToolResult>;
}

const ERROR_BODY_MAX_CHARS = 500;

const propertiesSchema = z
  .record(z.string(), z.unknown())
  .describe("Module-specific properties as a JSON object, e.g. {\"packageName\":\"com.example.app\",\"baseName\":\"myapp\"}.");

const optionalPropertiesSchema = propertiesSchema
  .optional()
  .describe("Module-specific properties as a JSON object. Omit when the module has no required properties.");

const commitSchema = z
  .boolean()
  .optional()
  .describe(
    "When true, seed4j runs `git commit` after applying the patch (one commit per module). Defaults to false. Set to true when the caller wants a clean per-feature history — e.g. when scaffolding a project end-to-end — and stays false for speculative or validation runs.",
  );

function text(body: string): ToolResult {
  return { content: [{ type: "text", text: body }] };
}

export function buildTools(client: Seed4jClient): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      name: "ping_seed4j",
      description:
        "Check whether the configured seed4j instance is reachable. Hits /api/modules (liveness) and /management/info (version, best-effort) with a short timeout (default 5 s), bypassing the catalogue cache and the retry layer so the result reflects current connectivity. Returns {reachable, ok, baseUrl, endpoint, status, latencyMs, version, checkedAt, error?}. Call this when a real tool unexpectedly fails, before a long apply plan, or to confirm the wiring on startup.",
      inputSchema: {
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Per-call timeout in milliseconds. Defaults to 5000 when omitted."),
      },
      handler: async ({ timeoutMs }) => text(await client.ping(timeoutMs)),
    },
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
        commit: commitSchema,
      },
      handler: async ({ moduleSlug, projectFolder, properties, commit }) =>
        text(await client.applyModule(moduleSlug, projectFolder, properties ?? {}, commit ?? false)),
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
        commit: commitSchema,
      },
      handler: async ({ projectFolder, properties, commit }) =>
        text(await client.createProject(projectFolder, properties, commit ?? false)),
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
        commit: commitSchema,
      },
      handler: async ({ projectFolder, steps, commit }) =>
        text(await client.applyModules(projectFolder, steps, commit ?? false)),
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
        commit: commitSchema,
      },
      handler: async ({ presetName, projectFolder, properties, commit }) =>
        text(await client.applyPreset(presetName, projectFolder, properties, commit ?? false)),
    },
  ];
  return tools.map((tool) => ({
    ...tool,
    handler: wrap(tool.name, tool.handler),
  }));
}

function wrap<Input>(
  toolName: string,
  handler: (input: Input) => Promise<ToolResult>,
): (input: Input) => Promise<ToolResult> {
  return async (input) => {
    try {
      return await handler(input);
    } catch (error) {
      return errorResult(toolName, error);
    }
  };
}

function errorResult(toolName: string, error: unknown): ToolResult {
  const payload = errorToPayload(toolName, error);
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError: true,
  };
}

function errorToPayload(toolName: string, error: unknown): Record<string, unknown> {
  if (error instanceof HttpError) {
    const isClientError = error.status >= 400 && error.status < 500;
    return {
      error: "http",
      tool: toolName,
      status: error.status,
      endpoint: error.url,
      message: `seed4j responded with HTTP ${error.status}`,
      bodyExcerpt: truncate(error.body, ERROR_BODY_MAX_CHARS),
      hint: isClientError
        ? "check the tool inputs — module slug, properties, or project folder may be wrong"
        : "seed4j returned a server error; check the seed4j server logs",
    };
  }
  if (error instanceof TimeoutError) {
    return {
      error: "timeout",
      tool: toolName,
      endpoint: `${error.method} ${error.url}`,
      timeoutMs: error.timeoutMs,
      message: `request timed out after ${error.timeoutMs}ms`,
      hint: "increase SEED4J_TIMEOUT_MS or verify seed4j is reachable at SEED4J_BASE_URL",
    };
  }
  if (error instanceof Error) {
    return {
      error: "client",
      tool: toolName,
      message: error.message,
    };
  }
  return {
    error: "unknown",
    tool: toolName,
    message: String(error),
  };
}

function truncate(body: string, maxChars: number): string {
  if (body.length <= maxChars) return body;
  const remaining = body.length - maxChars;
  return `${body.slice(0, maxChars)}… (${remaining} more chars)`;
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
