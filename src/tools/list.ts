// ABOUTME: List sessions tool
// ABOUTME: Browses sessions by date and/or project with filtering options

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecallDatabase } from "../db.js";

export function registerListTool(
  server: McpServer,
  db: RecallDatabase
): void {
  server.registerTool(
    "list_sessions",
    {
      description:
        "Browse sessions by date and/or project. Returns session summaries with metadata and journal headlines if available.",
      inputSchema: z.object({
        project: z
          .string()
          .optional()
          .describe("Filter by project name or ID"),
        date: z
          .string()
          .optional()
          .describe("Filter by date (YYYY-MM-DD format)"),
        limit: z
          .number()
          .int()
          .positive()
          .default(20)
          .describe("Maximum number of results to return"),
      }),
    },
    async ({ project, date, limit = 20 }) => {
      const results = db.listSessions(project, date, limit);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results),
          },
        ],
      };
    }
  );
}
