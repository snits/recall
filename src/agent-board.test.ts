// ABOUTME: Tests for AgentBoardReader session data and conversation formatting
// ABOUTME: Uses real filesystem fixtures — no mocks

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { AgentBoardReader } from "./agent-board";
import type { Message } from "./agent-board";

let basePath: string;
let reader: AgentBoardReader;

const SESSION_WITH_AGENTS = "sess-with-agents";
const SESSION_NO_AGENTS = "sess-no-agents";

const FIXTURES = {
  [SESSION_WITH_AGENTS]: {
    session: {
      agents: [{ agentId: "agent-abc", type: "Explore", messageCount: 2 }],
    },
    messages: [
      {
        uuid: "msg-001",
        parentUuid: null,
        agentId: null,
        role: "user",
        content: "Can you explore the codebase?",
        toolUse: [],
        timestamp: "2024-06-01T10:00:00Z",
        agentType: null,
      },
      {
        uuid: "msg-002",
        parentUuid: "msg-001",
        agentId: null,
        role: "assistant",
        content: "Sure, let me look around.",
        toolUse: [
          {
            tool: "Read",
            input: { file_path: "/src/index.ts" },
            summary: "Read the main entry point",
          },
        ],
        timestamp: "2024-06-01T10:01:00Z",
        agentType: null,
      },
      {
        uuid: "msg-003",
        parentUuid: "msg-002",
        agentId: null,
        role: "user",
        content: "What did you find?",
        toolUse: [],
        timestamp: "2024-06-01T10:02:00Z",
        agentType: null,
      },
      {
        uuid: "msg-004",
        parentUuid: "msg-003",
        agentId: null,
        role: "assistant",
        content: "The codebase is well structured.",
        toolUse: [
          {
            tool: "Grep",
            input: { pattern: "export" },
            summary: "Searched for exports",
          },
        ],
        timestamp: "2024-06-01T10:03:00Z",
        agentType: null,
      },
      {
        uuid: "msg-005",
        parentUuid: null,
        agentId: "agent-abc",
        role: "user",
        content: "Explore the test directory",
        toolUse: [],
        timestamp: "2024-06-01T10:01:30Z",
        agentType: "Explore",
      },
      {
        uuid: "msg-006",
        parentUuid: "msg-005",
        agentId: "agent-abc",
        role: "assistant",
        content: "Found 3 test files.",
        toolUse: [
          {
            tool: "Glob",
            input: { pattern: "**/*.test.ts" },
            summary: "Listed test files",
          },
          {
            tool: "Read",
            input: { file_path: "/src/db.test.ts" },
            summary: "Read the database tests",
          },
        ],
        timestamp: "2024-06-01T10:02:00Z",
        agentType: "Explore",
      },
    ],
  },
  [SESSION_NO_AGENTS]: {
    session: {
      agents: [],
    },
    messages: [
      {
        uuid: "msg-101",
        parentUuid: null,
        agentId: null,
        role: "user",
        content: "Hello, how are you?",
        toolUse: [],
        timestamp: "2024-06-02T09:00:00Z",
        agentType: null,
      },
      {
        uuid: "msg-102",
        parentUuid: "msg-101",
        agentId: null,
        role: "assistant",
        content: "I am doing well, thank you!",
        toolUse: [],
        timestamp: "2024-06-02T09:01:00Z",
        agentType: null,
      },
    ],
  },
};

beforeAll(() => {
  basePath = mkdtempSync(join(tmpdir(), "agent-board-test-"));

  for (const [sessionId, data] of Object.entries(FIXTURES)) {
    const sessionDir = join(basePath, "sessions", sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, "session.json"),
      JSON.stringify(data.session),
    );
    writeFileSync(
      join(sessionDir, "messages.json"),
      JSON.stringify(data.messages),
    );
  }
});

afterAll(() => {
  rmSync(basePath, { recursive: true, force: true });
});

describe("AgentBoardReader", () => {
  beforeAll(() => {
    reader = new AgentBoardReader(basePath);
  });

  describe("getSessionData", () => {
    it("returns roster and messages for session with agents", () => {
      const data = reader.getSessionData(SESSION_WITH_AGENTS);
      expect(data).not.toBeNull();
      expect(data!.roster).toHaveLength(1);
      expect(data!.roster[0]).toEqual({
        agentId: "agent-abc",
        type: "Explore",
        messageCount: 2,
      });
      expect(data!.messages).toHaveLength(6);
    });

    it("returns empty roster for session without agents", () => {
      const data = reader.getSessionData(SESSION_NO_AGENTS);
      expect(data).not.toBeNull();
      expect(data!.roster).toEqual([]);
      expect(data!.messages).toHaveLength(2);
    });

    it("returns null for non-existent session", () => {
      const data = reader.getSessionData("no-such-session");
      expect(data).toBeNull();
    });

    it("returns null when base path doesn't exist", () => {
      const badReader = new AgentBoardReader("/tmp/no-such-path-xyz");
      const data = badReader.getSessionData(SESSION_WITH_AGENTS);
      expect(data).toBeNull();
    });
  });

  describe("formatConversation", () => {
    let allMessages: Message[];
    let noAgentMessages: Message[];

    beforeAll(() => {
      const data = reader.getSessionData(SESSION_WITH_AGENTS);
      allMessages = data!.messages;
      const noAgentData = reader.getSessionData(SESSION_NO_AGENTS);
      noAgentMessages = noAgentData!.messages;
    });

    it("formats main conversation as markdown, filtering out subagent messages", () => {
      const formatted = reader.formatConversation(allMessages);
      expect(formatted).toContain("## User");
      expect(formatted).toContain("## Assistant");
      expect(formatted).toContain("Can you explore the codebase?");
      expect(formatted).toContain("Sure, let me look around.");
      expect(formatted).toContain("> Tool: Read the main entry point");
      // Subagent messages should be excluded
      expect(formatted).not.toContain("Explore the test directory");
      expect(formatted).not.toContain("Found 3 test files.");
    });

    it("formats specific agent's conversation", () => {
      const formatted = reader.formatConversation(allMessages, "agent-abc");
      expect(formatted).toContain("Explore the test directory");
      expect(formatted).toContain("Found 3 test files.");
      expect(formatted).toContain("> Tool: Listed test files");
      expect(formatted).toContain("> Tool: Read the database tests");
      // Main conversation messages should be excluded
      expect(formatted).not.toContain("Can you explore the codebase?");
    });

    it("applies character offset", () => {
      const full = reader.formatConversation(allMessages);
      const offset = reader.formatConversation(allMessages, undefined, 10);
      expect(offset).toBe(full.slice(10));
    });

    it("applies character limit", () => {
      const limited = reader.formatConversation(
        allMessages,
        undefined,
        undefined,
        50,
      );
      expect(limited.length).toBe(50);
    });

    it("applies both offset and limit", () => {
      const full = reader.formatConversation(allMessages);
      const partial = reader.formatConversation(
        allMessages,
        undefined,
        10,
        50,
      );
      expect(partial).toBe(full.slice(10, 60));
    });

    it("returns empty string when no messages match the agent", () => {
      const formatted = reader.formatConversation(
        allMessages,
        "nonexistent-agent",
      );
      expect(formatted).toBe("");
    });

    it("formats session without agents as full conversation", () => {
      const formatted = reader.formatConversation(noAgentMessages);
      expect(formatted).toContain("## User");
      expect(formatted).toContain("Hello, how are you?");
      expect(formatted).toContain("## Assistant");
      expect(formatted).toContain("I am doing well, thank you!");
    });
  });
});
