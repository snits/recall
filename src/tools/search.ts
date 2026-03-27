// ABOUTME: Search tool for engineering-notebook sessions
// ABOUTME: Searches journal summaries and conversation text across session history

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecallDatabase } from "../db.js";

export function registerSearchTool(
  server: McpServer,
  db: RecallDatabase
): void {
  server.registerTool(
    "search",
    {
      description:
        "Search engineering-notebook session history by query. Searches journal summaries first (fast, high signal), then falls back to conversation text if needed.",
      inputSchema: z.object({
        query: z
          .string()
          .describe("Search terms to find in journal entries and conversations"),
        project: z
          .string()
          .optional()
          .describe("Optional project name to filter results"),
        limit: z
          .number()
          .int()
          .positive()
          .optional()
          .default(10)
          .describe("Maximum number of results to return"),
      }),
    },
    async ({ query, project, limit = 10 }) => {
      // Search journal entries first (fast, high signal)
      const journalResults = db.searchJournal(query, project, limit);

      // If we have enough journal results, return them
      if (journalResults.length >= limit) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(journalResults.slice(0, limit)),
            },
          ],
        };
      }

      // Otherwise, search conversations for remaining results
      const remainingLimit = limit - journalResults.length;
      const conversationResults = db.searchConversations(
        query,
        project,
        remainingLimit
      );

      // Combine results (journal entries first, then conversations)
      const combinedResults = [...journalResults, ...conversationResults].slice(
        0,
        limit
      );

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(combinedResults),
          },
        ],
      };
    }
  );
}
