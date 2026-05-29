import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Seed4jClient } from "./client.js";

export interface ResourceDefinition {
  name: string;
  uri: string;
  description: string;
  mimeType: string;
  handler: () => Promise<string>;
}

export function buildResources(client: Seed4jClient): ResourceDefinition[] {
  return [
    {
      name: "modules-catalogue",
      uri: "seed4j://catalogue/modules",
      description:
        "Full seed4j module catalogue, grouped by category. JSON body returned by /api/modules. Use this resource for free browsing or attaching the catalogue once; the list_modules tool stays the right choice when the agent needs it inline. Backed by the catalogue cache (default 1 h TTL).",
      mimeType: "application/json",
      handler: () => client.listModules(),
    },
    {
      name: "modules-landscape",
      uri: "seed4j://catalogue/landscape",
      description:
        "Module dependency-ranked graph (the seed4j 'landscape'). JSON body returned by /api/modules-landscape. Use this resource to browse module relationships; the get_module_dependencies tool stays the right choice for a single-module prerequisite query. Backed by the catalogue cache.",
      mimeType: "application/json",
      handler: () => client.getModulesLandscape(),
    },
    {
      name: "presets-catalogue",
      uri: "seed4j://catalogue/presets",
      description:
        "Curated, pre-ordered seed4j presets. JSON body returned by /api/presets. Use this resource for browsing; the list_presets / get_preset_details tools stay the right choice when applying a preset inline. Backed by the catalogue cache.",
      mimeType: "application/json",
      handler: () => client.listPresets(),
    },
  ];
}

export function registerResources(server: McpServer, client: Seed4jClient): void {
  for (const resource of buildResources(client)) {
    server.registerResource(
      resource.name,
      resource.uri,
      { description: resource.description, mimeType: resource.mimeType },
      async (uri: URL) => ({
        contents: [
          {
            uri: uri.toString(),
            mimeType: resource.mimeType,
            text: await resource.handler(),
          },
        ],
      }),
    );
  }
}
