#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { Seed4jClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const { baseUrl, clientOptions, logFile, warnings } = loadConfig(process.env);
  for (const warning of warnings) {
    process.stderr.write(`seed4j-mcp: ${warning}\n`);
  }
  const logger = createLogger(logFile);
  process.on("exit", () => logger.close());
  const client = new Seed4jClient(baseUrl, undefined, { ...clientOptions, logger });
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
