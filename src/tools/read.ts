// ABOUTME: Read session tool handler
// ABOUTME: Registers the read_session MCP tool for retrieving full session conversations

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecallDatabase } from "../db.js";
import { AgentBoardReader } from "../agent-board.js";

export function registerReadTool(
  server: McpServer,
  db: RecallDatabase,
  agentBoard?: AgentBoardReader
): void {
  server.registerTool(
    "read_session",
    {
      description:
        "Read the full conversation for a specific session with optional offset and limit for chunked reading. " +
        "When agent-board data is available, includes a subagent roster. " +
        "Use agent_id to read a specific subagent's conversation.",
      inputSchema: z.object({
        session_id: z.string().describe("The session ID to read"),
        agent_id: z
          .string()
          .optional()
          .describe(
            "Optional agent ID to read a specific subagent's conversation instead of the main session"
          ),
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
    async ({ session_id, agent_id, offset, limit }) => {
      // Fetch metadata only (limit=0 avoids fetching conversation text)
      const session = db.readSession(session_id, 0, 0);

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

      const boardData = agentBoard?.getSessionData(session_id) ?? null;

      if (agent_id) {
        // Agent-specific conversation requested
        if (!boardData) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Subagent data not available for session: ${session_id}`,
                }),
              },
            ],
          };
        }

        const agentInfo = boardData.roster.find((a) => a.agentId === agent_id);
        if (!agentInfo) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  error: `Agent not found for session ${session_id}: ${agent_id}`,
                }),
              },
            ],
          };
        }

        const conversation = agentBoard!.formatConversation(
          boardData.messages,
          agent_id,
          offset,
          limit
        );

        const result = {
          session_id: session.sessionId,
          agent_id: agentInfo.agentId,
          agent_type: agentInfo.type,
          message_count: agentInfo.messageCount,
          conversation,
        };

        return {
          content: [{ type: "text", text: JSON.stringify(result) }],
        };
      }

      // Main session conversation
      let conversation: string;
      if (boardData) {
        conversation = agentBoard!.formatConversation(
          boardData.messages,
          undefined,
          offset,
          limit
        );
      } else {
        const fullSession = db.readSession(session_id, offset, limit);
        conversation = fullSession?.conversationText || "";
      }

      const agents = boardData?.roster ?? [];

      const result = {
        session_id: session.sessionId,
        project: session.projectName,
        date: session.startedAt.split("T")[0],
        git_branch: session.gitBranch,
        message_count: session.messageCount,
        conversation,
        agents,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    }
  );
}
