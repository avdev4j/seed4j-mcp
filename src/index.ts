#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Seed4jClient } from "./client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const baseUrl = process.env.SEED4J_BASE_URL ?? "http://localhost:1339";
  const client = new Seed4jClient(baseUrl);
  const server = createServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error: unknown) => {
  // stderr is fine for STDIO MCP; anything on stdout corrupts the framing.
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`seed4j-mcp failed to start: ${message}\n`);
  process.exit(1);
});
