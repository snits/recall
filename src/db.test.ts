// ABOUTME: Integration tests for the database query layer
// ABOUTME: Tests all query methods against a real in-memory SQLite fixture database

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import SqliteDatabase from "bun:sqlite";
import { RecallDatabase } from "./db";

import { mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

let dbPath: string;
let recall: RecallDatabase;

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
    ('proj-alpha', '/work/alpha', 'Alpha Project', 'First test project', '2024-01-01', '2024-01-10', 3),
    ('proj-beta',  '/work/beta',  'Beta Project',  'Second test project', '2024-02-01', '2024-02-15', 2);

  INSERT INTO sessions VALUES
    ('sess-001', NULL, 'proj-alpha', '/work/alpha', '/work/alpha/.sessions/001.jsonl', '2024-01-05T10:00:00Z', '2024-01-05T11:00:00Z', 'main', '1.0', 42, '2024-01-05T12:00:00Z', 0),
    ('sess-002', NULL, 'proj-alpha', '/work/alpha', '/work/alpha/.sessions/002.jsonl', '2024-01-08T14:00:00Z', '2024-01-08T15:30:00Z', 'feature/foo', '1.0', 18, '2024-01-08T16:00:00Z', 0),
    ('sess-003', NULL, 'proj-beta',  '/work/beta',  '/work/beta/.sessions/003.jsonl',  '2024-02-10T09:00:00Z', '2024-02-10T10:00:00Z', 'main', '1.0', 7,  '2024-02-10T11:00:00Z', 0);

  INSERT INTO conversations VALUES
    (1, 'sess-001', 'This session we implemented the authentication module and fixed several login bugs.', '2024-01-05T12:00:00Z'),
    (2, 'sess-002', 'Worked on the data pipeline refactoring. Improved throughput significantly.', '2024-01-08T16:00:00Z'),
    (3, 'sess-003', 'Beta project kickoff: scaffolded the new service and wrote initial tests.', '2024-02-10T11:00:00Z');

  INSERT INTO journal_entries VALUES
    (1, '2024-01-05', 'proj-alpha', '["sess-001"]', 'Authentication module complete', 'Implemented login and session management. Fixed token refresh bugs.', '["authentication","security","bugfix"]', NULL, '2024-01-05T12:30:00Z', 'claude-3', '[]'),
    (2, '2024-01-08', 'proj-alpha', '["sess-002"]', 'Pipeline refactor', 'Refactored the ETL pipeline for better performance and maintainability.', '["refactoring","performance","pipeline"]', NULL, '2024-01-08T16:30:00Z', 'claude-3', '[]'),
    (3, '2024-02-10', 'proj-beta',  '["sess-003"]', 'Beta kickoff', 'Scaffolded service, wrote initial integration tests.', '["setup","testing"]', NULL, '2024-02-10T11:30:00Z', 'claude-3', '[]');
`;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "recall-test-"));
  dbPath = join(dir, "fixture.db");

  const setup = new SqliteDatabase(dbPath);
  setup.run(SCHEMA_SQL);
  setup.run(FIXTURE_SQL);
  setup.close();

  recall = new RecallDatabase(dbPath);
});

afterAll(() => {
  recall.close();
});

describe("searchJournal", () => {
  it("finds entries matching headline", () => {
    const results = recall.searchJournal("Authentication");
    expect(results.length).toBe(1);
    expect(results[0].headline).toBe("Authentication module complete");
    expect(results[0].source).toBe("journal");
    expect(results[0].projectId).toBe("proj-alpha");
  });

  it("finds entries matching summary", () => {
    const results = recall.searchJournal("ETL pipeline");
    expect(results.length).toBe(1);
    expect(results[0].headline).toBe("Pipeline refactor");
  });

  it("finds entries matching topics", () => {
    const results = recall.searchJournal("performance");
    expect(results.length).toBe(1);
    expect(results[0].topics).toContain("performance");
  });

  it("returns parsed topics array", () => {
    const results = recall.searchJournal("authentication");
    expect(Array.isArray(results[0].topics)).toBe(true);
    expect(results[0].topics).toContain("authentication");
  });

  it("returns parsed sessionIds array", () => {
    const results = recall.searchJournal("authentication");
    expect(Array.isArray(results[0].sessionIds)).toBe(true);
    expect(results[0].sessionIds).toContain("sess-001");
  });

  it("filters by project id", () => {
    const results = recall.searchJournal("setup", "proj-beta");
    expect(results.length).toBe(1);
    expect(results[0].projectId).toBe("proj-beta");
  });

  it("filters by project display name", () => {
    const results = recall.searchJournal("pipeline", "Alpha");
    expect(results.length).toBe(1);
    expect(results[0].projectName).toBe("Alpha Project");
  });

  it("returns empty array when no match", () => {
    const results = recall.searchJournal("zzznomatch");
    expect(results).toEqual([]);
  });

  it("respects limit", () => {
    const results = recall.searchJournal("the", undefined, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

describe("searchConversations", () => {
  it("finds conversations matching text", () => {
    const results = recall.searchConversations("authentication module");
    expect(results.length).toBe(1);
    expect(results[0].sessionId).toBe("sess-001");
    expect(results[0].source).toBe("conversation");
  });

  it("includes a snippet", () => {
    const results = recall.searchConversations("authentication module");
    expect(typeof results[0].snippet).toBe("string");
    expect(results[0].snippet.length).toBeGreaterThan(0);
  });

  it("filters by project id", () => {
    const results = recall.searchConversations("test", "proj-beta");
    expect(results.every((r) => r.projectId === "proj-beta")).toBe(true);
  });

  it("returns empty array when no match", () => {
    const results = recall.searchConversations("zzznomatch");
    expect(results).toEqual([]);
  });
});

describe("readSession", () => {
  it("returns full session detail", () => {
    const detail = recall.readSession("sess-001");
    expect(detail).not.toBeNull();
    expect(detail!.sessionId).toBe("sess-001");
    expect(detail!.projectId).toBe("proj-alpha");
    expect(detail!.projectName).toBe("Alpha Project");
    expect(detail!.messageCount).toBe(42);
    expect(detail!.gitBranch).toBe("main");
    expect(detail!.conversationText).toContain("authentication module");
  });

  it("returns null for unknown session", () => {
    const detail = recall.readSession("no-such-session");
    expect(detail).toBeNull();
  });

  it("applies character offset", () => {
    const full = recall.readSession("sess-001");
    const offset = recall.readSession("sess-001", 5);
    expect(offset!.conversationText).toBe(full!.conversationText!.slice(5));
  });

  it("applies character limit", () => {
    const limited = recall.readSession("sess-001", 0, 10);
    expect(limited!.conversationText!.length).toBe(10);
  });

  it("applies both offset and limit", () => {
    const full = recall.readSession("sess-001");
    const partial = recall.readSession("sess-001", 5, 10);
    expect(partial!.conversationText).toBe(full!.conversationText!.slice(5, 15));
  });

  it("returns conversation text for sess-003", () => {
    const detail = recall.readSession("sess-003");
    expect(detail).not.toBeNull();
    expect(detail!.conversationText).toContain("Beta project kickoff");
  });
});

describe("listSessions", () => {
  it("lists all sessions by default", () => {
    const sessions = recall.listSessions();
    expect(sessions.length).toBe(3);
  });

  it("filters by project id", () => {
    const sessions = recall.listSessions("proj-alpha");
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.projectId === "proj-alpha")).toBe(true);
  });

  it("filters by project display name", () => {
    const sessions = recall.listSessions("Beta");
    expect(sessions.length).toBe(1);
    expect(sessions[0].projectId).toBe("proj-beta");
  });

  it("filters by date", () => {
    const sessions = recall.listSessions(undefined, "2024-01-05");
    expect(sessions.length).toBe(1);
    expect(sessions[0].sessionId).toBe("sess-001");
  });

  it("includes journal headline when available", () => {
    const sessions = recall.listSessions("proj-alpha");
    const withHeadline = sessions.filter((s) => s.journalHeadline !== null);
    expect(withHeadline.length).toBeGreaterThan(0);
    const sess001 = sessions.find((s) => s.sessionId === "sess-001");
    expect(sess001!.journalHeadline).toBe("Authentication module complete");
  });

  it("returns sessions ordered by most recent first", () => {
    const sessions = recall.listSessions();
    for (let i = 1; i < sessions.length; i++) {
      expect(sessions[i - 1].startedAt >= sessions[i].startedAt).toBe(true);
    }
  });

  it("respects limit", () => {
    const sessions = recall.listSessions(undefined, undefined, 1);
    expect(sessions.length).toBe(1);
  });
});
