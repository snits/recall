// ABOUTME: MCP server entry point for recall
// ABOUTME: Wires up database, tools, and stdio transport

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { RecallDatabase } from "./db.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { registerListTool } from "./tools/list.js";

const config = loadConfig();

let db: RecallDatabase;
try {
  db = new RecallDatabase(config.databasePath);
} catch (err) {
  process.stderr.write(`recall: failed to open database at ${config.databasePath}: ${err}\n`);
  process.exit(1);
}

const server = new McpServer({
  name: "recall",
  version: "0.1.0",
});

registerSearchTool(server, db);
registerReadTool(server, db);
registerListTool(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
