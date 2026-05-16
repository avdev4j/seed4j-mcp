import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { Seed4jClient } from "./client.js";
import { registerTools } from "./tools.js";

export interface ServerOptions {
  name?: string;
  version?: string;
}

export function createServer(client: Seed4jClient, options: ServerOptions = {}): McpServer {
  const server = new McpServer({
    name: options.name ?? "seed4j-mcp",
    version: options.version ?? "0.0.1",
  });
  registerTools(server, client);
  return server;
}
