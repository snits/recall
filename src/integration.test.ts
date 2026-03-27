// ABOUTME: Integration tests for the Recall MCP server tools
// ABOUTME: Tests all three MCP tools (search, read_session, list_sessions) via InMemoryTransport with real SQLite

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import SqliteDatabase from "bun:sqlite";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import { RecallDatabase } from "./db.js";
import { registerSearchTool } from "./tools/search.js";
import { registerReadTool } from "./tools/read.js";
import { registerListTool } from "./tools/list.js";

const SCHEMA_SQL = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    first_session_at TEXT,
    last_session_at TEXT,
    session_count INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    parent_session_id TEXT,
    project_id TEXT NOT NULL REFERENCES projects(id),
    project_path TEXT NOT NULL,
    source_path TEXT NOT NULL,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    git_branch TEXT,
    version TEXT,
    message_count INTEGER NOT NULL DEFAULT 0,
    ingested_at TEXT NOT NULL,
    is_subagent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id),
    conversation_markdown TEXT NOT NULL,
    extracted_at TEXT NOT NULL
  );

  CREATE TABLE journal_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    project_id TEXT NOT NULL REFERENCES projects(id),
    session_ids TEXT NOT NULL DEFAULT '[]',
    headline TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    topics TEXT NOT NULL DEFAULT '[]',
    commits TEXT,
    generated_at TEXT NOT NULL,
    model_used TEXT NOT NULL,
    open_questions TEXT NOT NULL DEFAULT '[]',
    UNIQUE(date, project_id)
  );
`;

const FIXTURE_SQL = `
  INSERT INTO projects VALUES
    ('proj-alpha', '/work/alpha', 'Alpha Project', 'First test project',  '2024-01-01', '2024-01-10', 3),
    ('proj-beta',  '/work/beta',  'Beta Project',  'Second test project', '2024-02-01', '2024-02-15', 2);

  INSERT INTO sessions VALUES
    ('sess-001', NULL, 'proj-alpha', '/work/alpha', '/work/alpha/.sessions/001.jsonl', '2024-01-05T10:00:00Z', '2024-01-05T11:00:00Z', 'main',        '1.0', 42, '2024-01-05T12:00:00Z', 0),
    ('sess-002', NULL, 'proj-alpha', '/work/alpha', '/work/alpha/.sessions/002.jsonl', '2024-01-08T14:00:00Z', '2024-01-08T15:30:00Z', 'feature/foo', '1.0', 18, '2024-01-08T16:00:00Z', 0),
    ('sess-003', NULL, 'proj-beta',  '/work/beta',  '/work/beta/.sessions/003.jsonl',  '2024-02-10T09:00:00Z', '2024-02-10T10:00:00Z', 'main',        '1.0',  7, '2024-02-10T11:00:00Z', 0);

  INSERT INTO conversations VALUES
    (1, 'sess-001', 'This session we implemented the authentication module and fixed several login bugs.', '2024-01-05T12:00:00Z'),
    (2, 'sess-002', 'Worked on the data pipeline refactoring. Improved throughput significantly.', '2024-01-08T16:00:00Z'),
    (3, 'sess-003', 'Beta project kickoff: scaffolded the new service and wrote initial tests.', '2024-02-10T11:00:00Z');

  INSERT INTO journal_entries VALUES
    (1, '2024-01-05', 'proj-alpha', '["sess-001"]', 'Authentication module complete', 'Implemented login and session management. Fixed token refresh bugs.', '["authentication","security","bugfix"]', NULL, '2024-01-05T12:30:00Z', 'claude-3', '[]'),
    (2, '2024-01-08', 'proj-alpha', '["sess-002"]', 'Pipeline refactor', 'Refactored the ETL pipeline for better performance and maintainability.', '["refactoring","performance","pipeline"]', NULL, '2024-01-08T16:30:00Z', 'claude-3', '[]'),
    (3, '2024-02-10', 'proj-beta',  '["sess-003"]', 'Beta kickoff', 'Scaffolded service, wrote initial integration tests.', '["setup","testing"]', NULL, '2024-02-10T11:30:00Z', 'claude-3', '[]');
`;

let client: Client;
let recall: RecallDatabase;

function parseResult(result: unknown): unknown {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0].text);
}

beforeAll(async () => {
  // Create fixture database
  const dir = mkdtempSync(join(tmpdir(), "recall-integration-"));
  const dbPath = join(dir, "fixture.db");
  const setup = new SqliteDatabase(dbPath);
  setup.run(SCHEMA_SQL);
  setup.run(FIXTURE_SQL);
  setup.close();

  recall = new RecallDatabase(dbPath);

  // Wire up MCP server with all three tools
  const server = new McpServer({ name: "recall-test", version: "0.1.0" });
  registerSearchTool(server, recall);
  registerReadTool(server, recall);
  registerListTool(server, recall);

  // Connect server and client via in-memory transport
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  client = new Client({ name: "test-client", version: "0.1.0" });
  await client.connect(clientTransport);
});

afterAll(() => {
  recall.close();
});

// ---------------------------------------------------------------------------
// search tool
// ---------------------------------------------------------------------------

describe("search tool", () => {
  it("finds journal entries by headline", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "Authentication module" },
    });
    const data = parseResult(result) as Array<{ headline: string; source: string }>;
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].headline).toBe("Authentication module complete");
    expect(data[0].source).toBe("journal");
  });

  it("finds journal entries by summary", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "ETL pipeline" },
    });
    const data = parseResult(result) as Array<{ headline: string }>;
    expect(data.length).toBe(1);
    expect(data[0].headline).toBe("Pipeline refactor");
  });

  it("finds journal entries by topic keyword in summary", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "performance" },
    });
    const data = parseResult(result) as Array<{ summary: string }>;
    expect(data.length).toBe(1);
    expect(data[0].summary).toContain("performance");
  });

  it("falls back to conversations when journal has fewer results than limit", async () => {
    // Query that matches one journal entry but limit=5 so conversations are also searched.
    // "tests" appears in both journal (Beta kickoff summary) and conversation (sess-003).
    // With limit=5, journal has 1 result, so conversation fallback runs.
    const result = await client.callTool({
      name: "search",
      arguments: { query: "pipeline", limit: 5 },
    });
    const data = parseResult(result) as Array<{ source: string }>;
    expect(Array.isArray(data)).toBe(true);
    // The one journal entry + any conversation results
    const sources = data.map((r) => r.source);
    expect(sources).toContain("journal");
  });

  it("returns conversation source when only conversation matches", async () => {
    // "login bugs" appears only in conversation text, not in any journal entry
    const result = await client.callTool({
      name: "search",
      arguments: { query: "login bugs" },
    });
    const data = parseResult(result) as Array<{ source: string; sessionId?: string }>;
    expect(data.length).toBeGreaterThan(0);
    expect(data[0].source).toBe("conversation");
  });

  it("filters by project name", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "the", project: "Beta" },
    });
    const data = parseResult(result) as Array<{ project?: string }>;
    for (const entry of data) {
      expect(entry.project).toContain("Beta");
    }
  });

  it("respects limit", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "the", limit: 1 },
    });
    const data = parseResult(result) as unknown[];
    expect(data.length).toBeLessThanOrEqual(1);
  });

  it("returns empty array for no match", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "zzznomatch" },
    });
    const data = parseResult(result) as unknown[];
    expect(data).toEqual([]);
  });

  it("returns journal entry with required fields", async () => {
    const result = await client.callTool({
      name: "search",
      arguments: { query: "authentication" },
    });
    const data = parseResult(result) as Array<Record<string, unknown>>;
    const entry = data[0];
    expect(typeof entry.headline).toBe("string");
    expect(typeof entry.summary).toBe("string");
    expect(typeof entry.project).toBe("string");
    expect(typeof entry.totalSessions).toBe("number");
    expect(entry.source).toBe("journal");
  });
});

// ---------------------------------------------------------------------------
// read_session tool
// ---------------------------------------------------------------------------

describe("read_session tool", () => {
  it("returns full session with conversation text", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001" },
    });
    const data = parseResult(result) as {
      session_id: string;
      project: string;
      date: string;
      git_branch: string;
      message_count: number;
      conversation: string;
    };
    expect(data.session_id).toBe("sess-001");
    expect(data.project).toBe("Alpha Project");
    expect(data.date).toBe("2024-01-05");
    expect(data.git_branch).toBe("main");
    expect(data.message_count).toBe(42);
    expect(data.conversation).toContain("authentication module");
  });

  it("returns error JSON for non-existent session", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "no-such-session" },
    });
    const data = parseResult(result) as { error: string };
    expect(typeof data.error).toBe("string");
    expect(data.error).toContain("no-such-session");
  });

  it("applies character offset for chunked reading", async () => {
    const full = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001" },
    });
    const offset = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001", offset: 5 },
    });
    const fullData = parseResult(full) as { conversation: string };
    const offsetData = parseResult(offset) as { conversation: string };
    expect(offsetData.conversation).toBe(fullData.conversation.slice(5));
  });

  it("applies character limit for chunked reading", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001", limit: 10 },
    });
    const data = parseResult(result) as { conversation: string };
    expect(data.conversation.length).toBe(10);
  });

  it("applies both offset and limit together", async () => {
    const full = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001" },
    });
    const partial = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-001", offset: 5, limit: 10 },
    });
    const fullData = parseResult(full) as { conversation: string };
    const partialData = parseResult(partial) as { conversation: string };
    expect(partialData.conversation).toBe(fullData.conversation.slice(5, 15));
  });

  it("returns correct project for beta session", async () => {
    const result = await client.callTool({
      name: "read_session",
      arguments: { session_id: "sess-003" },
    });
    const data = parseResult(result) as { project: string; conversation: string };
    expect(data.project).toBe("Beta Project");
    expect(data.conversation).toContain("Beta project kickoff");
  });
});

// ---------------------------------------------------------------------------
// list_sessions tool
// ---------------------------------------------------------------------------

describe("list_sessions tool", () => {
  it("lists all sessions when no filters given", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const data = parseResult(result) as unknown[];
    expect(data.length).toBe(3);
  });

  it("filters by project name", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { project: "Alpha" },
    });
    const data = parseResult(result) as Array<{ projectId: string }>;
    expect(data.length).toBe(2);
    expect(data.every((s) => s.projectId === "proj-alpha")).toBe(true);
  });

  it("filters by project id", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { project: "proj-beta" },
    });
    const data = parseResult(result) as Array<{ projectId: string }>;
    expect(data.length).toBe(1);
    expect(data[0].projectId).toBe("proj-beta");
  });

  it("filters by date", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { date: "2024-01-05" },
    });
    const data = parseResult(result) as Array<{ sessionId: string }>;
    expect(data.length).toBe(1);
    expect(data[0].sessionId).toBe("sess-001");
  });

  it("respects limit", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { limit: 1 },
    });
    const data = parseResult(result) as unknown[];
    expect(data.length).toBe(1);
  });

  it("includes journal headline when available", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { project: "proj-alpha" },
    });
    const data = parseResult(result) as Array<{
      sessionId: string;
      journalHeadline: string | null;
    }>;
    const sess001 = data.find((s) => s.sessionId === "sess-001");
    expect(sess001).toBeDefined();
    expect(sess001!.journalHeadline).toBe("Authentication module complete");
  });

  it("returns sessions ordered most recent first", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: {},
    });
    const data = parseResult(result) as Array<{ startedAt: string }>;
    for (let i = 1; i < data.length; i++) {
      expect(data[i - 1].startedAt >= data[i].startedAt).toBe(true);
    }
  });

  it("returns session entries with required metadata fields", async () => {
    const result = await client.callTool({
      name: "list_sessions",
      arguments: { limit: 1 },
    });
    const data = parseResult(result) as Array<Record<string, unknown>>;
    const entry = data[0];
    expect(typeof entry.sessionId).toBe("string");
    expect(typeof entry.projectId).toBe("string");
    expect(typeof entry.projectName).toBe("string");
    expect(typeof entry.startedAt).toBe("string");
    expect(typeof entry.messageCount).toBe("number");
  });
});
