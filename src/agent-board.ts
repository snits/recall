// ABOUTME: Reads session data from agent-board's preprocessed filesystem store
// ABOUTME: Provides structured access to session roster, messages, and conversation formatting

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface AgentInfo {
  agentId: string;
  type: string;
  messageCount: number;
}

export interface ToolUseSummary {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
}

export interface Message {
  uuid: string;
  parentUuid: string | null;
  agentId: string | null;
  role: "user" | "assistant";
  content: string;
  toolUse: ToolUseSummary[];
  timestamp: string;
  agentType: string | null;
}

export interface SessionData {
  roster: AgentInfo[];
  messages: Message[];
}

export class AgentBoardReader {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  getSessionData(sessionId: string): SessionData | null {
    const sessionDir = join(this.basePath, "sessions", sessionId);
    const sessionPath = join(sessionDir, "session.json");
    const messagesPath = join(sessionDir, "messages.json");

    if (!existsSync(sessionPath) || !existsSync(messagesPath)) {
      return null;
    }

    try {
      const sessionRaw = JSON.parse(readFileSync(sessionPath, "utf-8"));
      const messagesRaw = JSON.parse(readFileSync(messagesPath, "utf-8"));

      const roster: AgentInfo[] = (sessionRaw.roster ?? []).map(
        (r: Record<string, unknown>) => ({
          agentId: r.agentId as string,
          type: r.type as string,
          messageCount: r.messageCount as number,
        }),
      );

      const messages: Message[] = (messagesRaw as Record<string, unknown>[]).map(
        (m) => ({
          uuid: m.uuid as string,
          parentUuid: (m.parentUuid as string | null) ?? null,
          agentId: (m.agentId as string | null) ?? null,
          role: m.role as "user" | "assistant",
          content: m.content as string,
          toolUse: ((m.toolUse as Record<string, unknown>[]) ?? []).map(
            (t) => ({
              tool: t.tool as string,
              input: (t.input as Record<string, unknown>) ?? {},
              summary: t.summary as string,
            }),
          ),
          timestamp: m.timestamp as string,
          agentType: (m.agentType as string | null) ?? null,
        }),
      );

      return { roster, messages };
    } catch {
      return null;
    }
  }

  formatConversation(
    messages: Message[],
    agentId?: string,
    offset?: number,
    limit?: number,
  ): string {
    const filtered = messages.filter((m) =>
      agentId === undefined ? m.agentId === null : m.agentId === agentId,
    );

    const parts = filtered.map((m) => {
      const header =
        m.role === "user" ? "## User" : "## Assistant";
      const lines = [header, "", m.content];

      for (const t of m.toolUse) {
        const label = t.summary || t.tool;
        lines.push(`> Tool: ${label}`);
      }

      return lines.join("\n");
    });

    const full = parts.join("\n\n");

    if (offset !== undefined || limit !== undefined) {
      const start = offset ?? 0;
      const end = limit !== undefined ? start + limit : undefined;
      return full.slice(start, end);
    }

    return full;
  }
}
