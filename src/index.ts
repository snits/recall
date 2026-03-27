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
const db = new RecallDatabase(config.databasePath);

const server = new McpServer({
  name: "recall",
  version: "0.1.0",
});

registerSearchTool(server, db);
registerReadTool(server, db);
registerListTool(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
