import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Seed4jClient } from "./client.js";
import { registerPrompts } from "./prompts.js";
import { registerResources } from "./resources.js";
import { registerTools } from "./tools.js";
import { PACKAGE_VERSION } from "./version.js";

export interface ServerOptions {
  name?: string;
  version?: string;
}

export function createServer(client: Seed4jClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "seed4j-mcp",
    version: options.version ?? PACKAGE_VERSION,
  });
  registerTools(server, client);
  registerResources(server, client);
  registerPrompts(server);
  return server;
}
