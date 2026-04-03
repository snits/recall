# Agent-Board Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance `read_session` to use agent-board's preprocessed data for conversation content (including subagent visibility), falling back to notebook.db for sessions agent-board hasn't processed.

**Architecture:** New `AgentBoardReader` class reads from agent-board's filesystem store (`~/.local/share/agent-board/sessions/`). The `read_session` tool handler queries both sources: notebook.db for session metadata, agent-board for conversation content and subagent roster. Agent-board is preferred when available; notebook.db is the fallback.

**Tech Stack:** Bun runtime, `bun:sqlite`, `@modelcontextprotocol/sdk`, filesystem JSON reads via `node:fs`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/config.ts` | Modify | Add `agentBoardPath` to Config |
| `src/agent-board.ts` | Create | AgentBoardReader class — reads session.json/messages.json, formats conversation markdown |
| `src/agent-board.test.ts` | Create | Unit tests for AgentBoardReader against temp fixture directories |
| `src/tools/read.ts` | Modify | Integrate AgentBoardReader, add `agent_id` parameter |
| `src/integration.test.ts` | Modify | Add MCP-level tests for agent-board enriched read_session |
| `src/index.ts` | Modify | Create AgentBoardReader, pass to registerReadTool |

---

### Task 1: Add agentBoardPath to Config

**Files:**
- Modify: `src/config.ts`

- [ ] **Step 1: Write the failing test**

No separate test file for config — it's 3 lines. The existing integration tests will exercise it. Add the field directly.

- [ ] **Step 2: Add agentBoardPath to Config interface and loadConfig**

In `src/config.ts`, add `agentBoardPath` to the `Config` interface and resolve it in `loadConfig`:

```typescript
import { homedir } from "os";
import { join } from "path";

export interface Config {
  databasePath: string;
  agentBoardPath: string;
}

export function loadConfig(): Config {
  const databasePath =
    process.env.RECALL_DB_PATH ??
    join(homedir(), ".config", "engineering-notebook", "notebook.db");

  const agentBoardPath =
    process.env.AGENT_BOARD_PATH ??
    join(homedir(), ".local", "share", "agent-board");

  return { databasePath, agentBoardPath };
}
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `bun test`
Expected: All 48 existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/config.ts
git commit -s -m "feat: add agentBoardPath to config

Resolves from AGENT_BOARD_PATH env var or defaults to
~/.local/share/agent-board."
```

---

### Task 2: AgentBoardReader — getSessionData

**Files:**
- Create: `src/agent-board.ts`
- Create: `src/agent-board.test.ts`

- [ ] **Step 1: Write the failing test for getSessionData returning data**

Create `src/agent-board.test.ts`:

```typescript
// ABOUTME: Unit tests for the AgentBoardReader class
// ABOUTME: Tests reading session data and formatting conversations from agent-board's preprocessed store

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { AgentBoardReader } from "./agent-board";

let basePath: string;
const SESSION_WITH_AGENTS = "sess-with-agents";
const SESSION_NO_AGENTS = "sess-no-agents";

beforeAll(() => {
  basePath = mkdtempSync(join(tmpdir(), "agent-board-test-"));

  // Session with subagents
  const withAgentsDir = join(basePath, "sessions", SESSION_WITH_AGENTS);
  mkdirSync(withAgentsDir, { recursive: true });
  writeFileSync(
    join(withAgentsDir, "session.json"),
    JSON.stringify({
      id: SESSION_WITH_AGENTS,
      startTime: "2024-03-01T10:00:00Z",
      endTime: "2024-03-01T11:00:00Z",
      messageCount: 6,
      agentCount: 1,
      agents: [
        { agentId: "agent-abc", type: "Explore", messageCount: 2 },
      ],
    })
  );
  writeFileSync(
    join(withAgentsDir, "messages.json"),
    JSON.stringify([
      {
        uuid: "msg-1",
        parentUuid: null,
        agentId: null,
        role: "user",
        content: "Help me understand the codebase",
        toolUse: [],
        timestamp: "2024-03-01T10:00:00Z",
        agentType: null,
      },
      {
        uuid: "msg-2",
        parentUuid: "msg-1",
        agentId: null,
        role: "assistant",
        content: "I'll explore the project structure.",
        toolUse: [
          { tool: "Read", input: { file_path: "src/index.ts" }, summary: "Read src/index.ts" },
        ],
        timestamp: "2024-03-01T10:00:30Z",
        agentType: null,
      },
      {
        uuid: "msg-3",
        parentUuid: null,
        agentId: "agent-abc",
        role: "user",
        content: "Explore the database layer",
        toolUse: [],
        timestamp: "2024-03-01T10:01:00Z",
        agentType: "Explore",
      },
      {
        uuid: "msg-4",
        parentUuid: "msg-3",
        agentId: "agent-abc",
        role: "assistant",
        content: "Found the database module at src/db.ts.",
        toolUse: [
          { tool: "Read", input: { file_path: "src/db.ts" }, summary: "Read src/db.ts" },
          { tool: "Grep", input: { pattern: "SELECT" }, summary: "Search for SELECT queries" },
        ],
        timestamp: "2024-03-01T10:01:30Z",
        agentType: "Explore",
      },
      {
        uuid: "msg-5",
        parentUuid: "msg-2",
        agentId: null,
        role: "user",
        content: "What did you find?",
        toolUse: [],
        timestamp: "2024-03-01T10:02:00Z",
        agentType: null,
      },
      {
        uuid: "msg-6",
        parentUuid: "msg-5",
        agentId: null,
        role: "assistant",
        content: "The project has a clean architecture.",
        toolUse: [],
        timestamp: "2024-03-01T10:02:30Z",
        agentType: null,
      },
    ])
  );

  // Session without subagents
  const noAgentsDir = join(basePath, "sessions", SESSION_NO_AGENTS);
  mkdirSync(noAgentsDir, { recursive: true });
  writeFileSync(
    join(noAgentsDir, "session.json"),
    JSON.stringify({
      id: SESSION_NO_AGENTS,
      startTime: "2024-03-02T10:00:00Z",
      endTime: "2024-03-02T10:30:00Z",
      messageCount: 2,
      agentCount: 0,
      agents: [],
    })
  );
  writeFileSync(
    join(noAgentsDir, "messages.json"),
    JSON.stringify([
      {
        uuid: "msg-a",
        parentUuid: null,
        agentId: null,
        role: "user",
        content: "Simple question",
        toolUse: [],
        timestamp: "2024-03-02T10:00:00Z",
        agentType: null,
      },
      {
        uuid: "msg-b",
        parentUuid: "msg-a",
        agentId: null,
        role: "assistant",
        content: "Simple answer",
        toolUse: [],
        timestamp: "2024-03-02T10:00:30Z",
        agentType: null,
      },
    ])
  );
});

afterAll(() => {
  rmSync(basePath, { recursive: true, force: true });
});

describe("AgentBoardReader.getSessionData", () => {
  it("returns roster and messages for a session with agents", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS);
    expect(data).not.toBeNull();
    expect(data!.roster).toEqual([
      { agentId: "agent-abc", type: "Explore", messageCount: 2 },
    ]);
    expect(data!.messages.length).toBe(6);
  });

  it("returns empty roster for a session without agents", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_NO_AGENTS);
    expect(data).not.toBeNull();
    expect(data!.roster).toEqual([]);
    expect(data!.messages.length).toBe(2);
  });

  it("returns null for a non-existent session", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData("no-such-session");
    expect(data).toBeNull();
  });

  it("returns null when base path does not exist", () => {
    const reader = new AgentBoardReader("/tmp/nonexistent-agent-board-path");
    const data = reader.getSessionData(SESSION_WITH_AGENTS);
    expect(data).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/agent-board.test.ts`
Expected: FAIL — `Cannot find module "./agent-board"`

- [ ] **Step 3: Write AgentBoardReader with getSessionData**

Create `src/agent-board.ts`:

```typescript
// ABOUTME: Reads session data from agent-board's preprocessed filesystem store
// ABOUTME: Provides conversation content and subagent roster for read_session enrichment

import { readFileSync, existsSync } from "fs";
import { join } from "path";

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
    const sessionFile = join(sessionDir, "session.json");
    const messagesFile = join(sessionDir, "messages.json");

    if (!existsSync(sessionFile) || !existsSync(messagesFile)) {
      return null;
    }

    try {
      const sessionJson = JSON.parse(readFileSync(sessionFile, "utf-8"));
      const messagesJson = JSON.parse(readFileSync(messagesFile, "utf-8"));

      const roster: AgentInfo[] = (sessionJson.agents ?? []).map(
        (a: { agentId: string; type: string; messageCount: number }) => ({
          agentId: a.agentId,
          type: a.type,
          messageCount: a.messageCount,
        })
      );

      const messages: Message[] = messagesJson.map(
        (m: Record<string, unknown>) => ({
          uuid: m.uuid as string,
          parentUuid: (m.parentUuid as string) ?? null,
          agentId: (m.agentId as string) ?? null,
          role: m.role as "user" | "assistant",
          content: (m.content as string) ?? "",
          toolUse: (m.toolUse as ToolUseSummary[]) ?? [],
          timestamp: m.timestamp as string,
          agentType: (m.agentType as string) ?? null,
        })
      );

      return { roster, messages };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/agent-board.test.ts`
Expected: All 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-board.ts src/agent-board.test.ts
git commit -s -m "feat: add AgentBoardReader with getSessionData

Reads session.json and messages.json from agent-board's preprocessed
store. Returns agent roster and message array, or null if session
data is unavailable."
```

---

### Task 3: AgentBoardReader — formatConversation

**Files:**
- Modify: `src/agent-board.ts`
- Modify: `src/agent-board.test.ts`

- [ ] **Step 1: Write the failing test for formatting main conversation**

Add to `src/agent-board.test.ts`:

```typescript
describe("AgentBoardReader.formatConversation", () => {
  it("formats main conversation as markdown", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const md = reader.formatConversation(data.messages);
    expect(md).toContain("## User\n\nHelp me understand the codebase");
    expect(md).toContain("## Assistant\n\nI'll explore the project structure.");
    expect(md).toContain("> Tool: Read src/index.ts");
    // Should NOT contain subagent messages
    expect(md).not.toContain("Explore the database layer");
    expect(md).not.toContain("Found the database module");
  });

  it("formats a specific agent's conversation", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const md = reader.formatConversation(data.messages, "agent-abc");
    expect(md).toContain("## User\n\nExplore the database layer");
    expect(md).toContain("## Assistant\n\nFound the database module at src/db.ts.");
    expect(md).toContain("> Tool: Read src/db.ts");
    expect(md).toContain("> Tool: Search for SELECT queries");
    // Should NOT contain main conversation messages
    expect(md).not.toContain("Help me understand the codebase");
  });

  it("applies character offset", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const full = reader.formatConversation(data.messages);
    const offset = reader.formatConversation(data.messages, undefined, 10);
    expect(offset).toBe(full.slice(10));
  });

  it("applies character limit", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const limited = reader.formatConversation(data.messages, undefined, 0, 50);
    expect(limited.length).toBe(50);
  });

  it("applies both offset and limit", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const full = reader.formatConversation(data.messages);
    const partial = reader.formatConversation(data.messages, undefined, 10, 50);
    expect(partial).toBe(full.slice(10, 60));
  });

  it("returns empty string when no messages match the agent", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_WITH_AGENTS)!;
    const md = reader.formatConversation(data.messages, "nonexistent-agent");
    expect(md).toBe("");
  });

  it("formats session without agents as full conversation", () => {
    const reader = new AgentBoardReader(basePath);
    const data = reader.getSessionData(SESSION_NO_AGENTS)!;
    const md = reader.formatConversation(data.messages);
    expect(md).toContain("## User\n\nSimple question");
    expect(md).toContain("## Assistant\n\nSimple answer");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/agent-board.test.ts`
Expected: FAIL — `reader.formatConversation is not a function`

- [ ] **Step 3: Implement formatConversation**

Add to `AgentBoardReader` class in `src/agent-board.ts`:

```typescript
  formatConversation(
    messages: Message[],
    agentId?: string,
    offset: number = 0,
    limit?: number
  ): string {
    const filtered = messages.filter((m) =>
      agentId !== undefined ? m.agentId === agentId : m.agentId === null
    );

    const parts: string[] = [];
    for (const msg of filtered) {
      const header = msg.role === "user" ? "## User" : "## Assistant";
      let block = `${header}\n\n${msg.content}`;

      if (msg.toolUse.length > 0) {
        const toolLines = msg.toolUse
          .map((t) => `> Tool: ${t.summary || t.tool}`)
          .join("\n");
        block += "\n" + toolLines;
      }

      parts.push(block);
    }

    const full = parts.join("\n\n");

    if (offset === 0 && limit === undefined) {
      return full;
    }

    const end = limit !== undefined ? offset + limit : undefined;
    return full.slice(offset, end);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/agent-board.test.ts`
Expected: All 11 tests PASS (4 getSessionData + 7 formatConversation).

- [ ] **Step 5: Commit**

```bash
git add src/agent-board.ts src/agent-board.test.ts
git commit -s -m "feat: add formatConversation to AgentBoardReader

Formats messages as markdown matching engineering-notebook style.
Filters by agentId (null for main conversation, specific ID for
subagent). Includes tool use summaries as blockquote lines.
Supports character offset/limit for chunked reading."
```

---

### Task 4: Enhance read_session Tool

**Files:**
- Modify: `src/tools/read.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Write the failing integration test for agent roster**

Add a new describe block to `src/integration.test.ts`. First, update the imports and beforeAll to also set up agent-board fixture data.

Update the imports at the top of `src/integration.test.ts`. Change the existing `fs` import to include the additional functions, and add the AgentBoardReader import:

```typescript
import { mkdtempSync, mkdirSync, writeFileSync } from "fs";
import { AgentBoardReader } from "./agent-board.js";
```

Update the existing `beforeAll` to also create agent-board fixture data and pass the reader to `registerReadTool`. Add after the existing fixture database creation:

```typescript
  // Create agent-board fixture directory
  const agentBoardPath = join(dir, "agent-board");

  // sess-001 has agent-board data with one subagent
  const sess001Dir = join(agentBoardPath, "sessions", "sess-001");
  mkdirSync(sess001Dir, { recursive: true });
  writeFileSync(
    join(sess001Dir, "session.json"),
    JSON.stringify({
      id: "sess-001",
      startTime: "2024-01-05T10:00:00Z",
      endTime: "2024-01-05T11:00:00Z",
      messageCount: 4,
      agentCount: 1,
      agents: [
        { agentId: "agent-xyz", type: "Explore", messageCount: 2 },
      ],
    })
  );
  writeFileSync(
    join(sess001Dir, "messages.json"),
    JSON.stringify([
      {
        uuid: "m1",
        parentUuid: null,
        agentId: null,
        role: "user",
        content: "We need to implement the authentication module and fix the login bugs",
        toolUse: [],
        timestamp: "2024-01-05T10:00:00Z",
        agentType: null,
      },
      {
        uuid: "m2",
        parentUuid: "m1",
        agentId: null,
        role: "assistant",
        content: "I'll implement the authentication module and fix several login bugs.",
        toolUse: [
          { tool: "Write", input: { file_path: "src/auth.ts" }, summary: "Write src/auth.ts" },
        ],
        timestamp: "2024-01-05T10:01:00Z",
        agentType: null,
      },
      {
        uuid: "m3",
        parentUuid: null,
        agentId: "agent-xyz",
        role: "user",
        content: "Explore existing auth patterns",
        toolUse: [],
        timestamp: "2024-01-05T10:02:00Z",
        agentType: "Explore",
      },
      {
        uuid: "m4",
        parentUuid: "m3",
        agentId: "agent-xyz",
        role: "assistant",
        content: "Found JWT middleware in the codebase.",
        toolUse: [
          { tool: "Grep", input: { pattern: "jwt" }, summary: "Search for jwt" },
        ],
        timestamp: "2024-01-05T10:02:30Z",
        agentType: "Explore",
      },
    ])
  );

  // sess-003 has NO agent-board data (tests fallback to notebook.db)

  const agentBoard = new AgentBoardReader(agentBoardPath);
```

Update the `registerReadTool` call to pass the reader:

```typescript
  registerReadTool(server, recall, agentBoard);
```

- [ ] **Step 2: Add integration tests for agent-board enrichment**

Add to `src/integration.test.ts` inside the `read_session tool` describe block:

```typescript
  it("includes agents roster when agent-board has data", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001" },
    });
    const data = parseResult(result) as {
      agents: Array<{ agent_id: string; type: string; message_count: number }>;
    };
    expect(data.agents).toEqual([
      { agent_id: "agent-xyz", type: "Explore", message_count: 2 },
    ]);
  });

  it("uses agent-board conversation when available", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001" },
    });
    const data = parseResult(result) as { conversation: string };
    // Agent-board formatted markdown, not notebook.db text
    expect(data.conversation).toContain("## User");
    expect(data.conversation).toContain("authentication module");
    expect(data.conversation).toContain("> Tool: Write src/auth.ts");
  });

  it("falls back to notebook.db when agent-board lacks session", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-003" },
    });
    const data = parseResult(result) as {
      conversation: string;
      agents: unknown[];
    };
    // Falls back to notebook.db conversation_markdown
    expect(data.conversation).toContain("Beta project kickoff");
    expect(data.agents).toEqual([]);
  });

  it("returns agent conversation when agent_id is provided", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001", agent_id: "agent-xyz" },
    });
    const data = parseResult(result) as {
      agent_id: string;
      agent_type: string;
      message_count: number;
      conversation: string;
    };
    expect(data.agent_id).toBe("agent-xyz");
    expect(data.agent_type).toBe("Explore");
    expect(data.message_count).toBe(2);
    expect(data.conversation).toContain("Explore existing auth patterns");
    expect(data.conversation).toContain("> Tool: Search for jwt");
    // Should NOT contain main conversation
    expect(data.conversation).not.toContain("authentication module");
  });

  it("returns error when agent_id requested but agent-board has no data", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-003", agent_id: "agent-xyz" },
    });
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Subagent data not available");
  });

  it("returns error when agent_id not found in roster", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001", agent_id: "nonexistent" },
    });
    const data = parseResult(result) as { error: string };
    expect(data.error).toContain("Agent not found");
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bun test src/integration.test.ts`
Expected: FAIL — `registerReadTool` doesn't accept AgentBoardReader parameter yet.

- [ ] **Step 4: Update registerReadTool signature and implement agent-board integration**

Update `src/tools/read.ts`:

```typescript
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
        "Read the full conversation for a specific session. Includes subagent roster when available. Use agent_id to read a specific subagent's conversation.",
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
      // Metadata-only check from notebook.db (limit=0 avoids fetching conversation text)
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

      // Agent-specific conversation requested
      if (agent_id) {
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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                session_id,
                agent_id,
                agent_type: agentInfo.type,
                message_count: agentInfo.messageCount,
                conversation,
              }),
            },
          ],
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
        // Fall back to notebook.db (fetch with real offset/limit)
        const fallback = db.readSession(session_id, offset, limit);
        conversation = fallback?.conversationText ?? "";
      }

      const agents = (boardData?.roster ?? []).map((a) => ({
        agent_id: a.agentId,
        type: a.type,
        message_count: a.messageCount,
      }));

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
```

- [ ] **Step 5: Update index.ts to create AgentBoardReader and pass it**

Update `src/index.ts`:

```typescript
// ABOUTME: MCP server entry point for recall
// ABOUTME: Wires up database, tools, and stdio transport

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { RecallDatabase } from "./db.js";
import { AgentBoardReader } from "./agent-board.js";
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

const agentBoard = new AgentBoardReader(config.agentBoardPath);

const server = new McpServer({
  name: "recall",
  version: "0.1.0",
});

registerSearchTool(server, db);
registerReadTool(server, db, agentBoard);
registerListTool(server, db);

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 6: Run all tests**

Run: `bun test`
Expected: All tests PASS — existing tests + new integration tests.

- [ ] **Step 7: Commit**

```bash
git add src/tools/read.ts src/index.ts src/integration.test.ts
git commit -s -m "feat: enhance read_session with agent-board enrichment

read_session now queries agent-board for conversation content and
subagent roster, falling back to notebook.db when unavailable. New
agent_id parameter allows reading a specific subagent's conversation.
Addresses recall-7sj."
```

---

### Task 5: Verify End-to-End and Close

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `bun test`
Expected: All tests pass, no regressions.

- [ ] **Step 2: Build the binary**

Run: `bun build src/index.ts --compile --outfile recall`
Expected: Binary compiles without errors.

- [ ] **Step 3: Install updated binary**

Run: `cp recall ~/.local/bin/recall`
Expected: Binary copied successfully.

- [ ] **Step 4: Smoke test against real data**

Restart the recall MCP server and test with a real session ID that has subagent data. Use the MCP inspector or call the tool directly.

- [ ] **Step 5: Close the beads issue**

Run: `bd close recall-7sj --reason="Enhanced read_session to use agent-board preprocessed data for conversation content and subagent roster"`
