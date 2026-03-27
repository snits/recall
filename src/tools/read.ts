// ABOUTME: Read session tool handler
// ABOUTME: Registers the read_session MCP tool for retrieving full session conversations

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecallDatabase } from "../db.js";

export function registerReadTool(
  server: McpServer,
  db: RecallDatabase
): void {
  server.registerTool(
    "read_session",
    {
      description:
        "Read the full conversation for a specific session with optional offset and limit for chunked reading",
      inputSchema: z.object({
        session_id: z.string().describe("The session ID to read"),
        offset: z
          .number()
          .optional()
          .default(0)
          .describe("Character offset for large sessions"),
        limit: z
          .number()
          .optional()
          .default(50000)
          .describe("Character limit for the response"),
      }),
    },
    async ({ session_id, offset, limit }) => {
      const session = db.readSession(session_id, offset, limit);

      if (!session) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `Session not found: ${session_id}`,
              }),
            },
          ],
        };
      }

      const result = {
        session_id: session.sessionId,
        project: session.projectName,
        date: session.startedAt.split("T")[0],
        git_branch: session.gitBranch,
        message_count: session.messageCount,
        conversation: session.conversationText || "",
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );
}
