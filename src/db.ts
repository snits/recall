// ABOUTME: SQLite connection and query interface for engineering-notebook session history
// ABOUTME: Provides read-only search and retrieval of sessions, journal entries, and conversations

import SqliteDatabase from "bun:sqlite";

export interface JournalSearchResult {
  sessionIds: string[];
  projectId: string;
  projectName: string;
  date: string;
  headline: string;
  summary: string;
  topics: string[];
  source: "journal";
}

export interface ConversationSearchResult {
  sessionId: string;
  projectId: string;
  projectName: string;
  date: string;
  snippet: string;
  source: "conversation";
}

export interface SessionDetail {
  sessionId: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  gitBranch: string | null;
  messageCount: number;
  conversationText: string | null;
}

export interface SessionListEntry {
  sessionId: string;
  projectId: string;
  projectName: string;
  startedAt: string;
  endedAt: string | null;
  gitBranch: string | null;
  messageCount: number;
  journalHeadline: string | null;
  journalDate: string | null;
}

export class RecallDatabase {
  private db: SqliteDatabase;

  constructor(path: string) {
    this.db = new SqliteDatabase(path, { readonly: true });
  }

  searchJournal(
    query: string,
    project?: string,
    limit: number = 20
  ): JournalSearchResult[] {
    const pattern = `%${query}%`;

    let sql = `
      SELECT
        j.session_ids,
        j.project_id,
        p.display_name AS project_name,
        j.date,
        j.headline,
        j.summary,
        j.topics
      FROM journal_entries j
      JOIN projects p ON p.id = j.project_id
      WHERE (j.headline LIKE ? OR j.summary LIKE ? OR j.topics LIKE ?)
    `;
    const params: (string | number)[] = [pattern, pattern, pattern];

    if (project) {
      sql += ` AND (j.project_id = ? OR p.display_name LIKE ?)`;
      params.push(project, `%${project}%`);
    }

    sql += ` ORDER BY j.date DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as Array<{
      session_ids: string;
      project_id: string;
      project_name: string;
      date: string;
      headline: string;
      summary: string;
      topics: string;
    }>;

    return rows.map((row) => ({
      sessionIds: safeParseJson(row.session_ids, []),
      projectId: row.project_id,
      projectName: row.project_name,
      date: row.date,
      headline: row.headline,
      summary: row.summary,
      topics: safeParseJson(row.topics, []),
      source: "journal" as const,
    }));
  }

  searchConversations(
    query: string,
    project?: string,
    limit: number = 20
  ): ConversationSearchResult[] {
    const pattern = `%${query}%`;

    let sql = `
      SELECT
        c.session_id,
        s.project_id,
        p.display_name AS project_name,
        s.started_at,
        c.conversation_markdown
      FROM conversations c
      JOIN sessions s ON s.id = c.session_id
      JOIN projects p ON p.id = s.project_id
      WHERE c.conversation_markdown LIKE ?
    `;
    const params: (string | number)[] = [pattern];

    if (project) {
      sql += ` AND (s.project_id = ? OR p.display_name LIKE ?)`;
      params.push(project, `%${project}%`);
    }

    sql += ` ORDER BY s.started_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as Array<{
      session_id: string;
      project_id: string;
      project_name: string;
      started_at: string;
      conversation_markdown: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      projectId: row.project_id,
      projectName: row.project_name,
      date: row.started_at,
      snippet: extractSnippet(row.conversation_markdown, query),
      source: "conversation" as const,
    }));
  }

  readSession(
    sessionId: string,
    offset: number = 0,
    limit?: number
  ): SessionDetail | null {
    const sessionRow = this.db
      .query(
        `
      SELECT
        s.id AS session_id,
        s.project_id,
        p.display_name AS project_name,
        s.started_at,
        s.ended_at,
        s.git_branch,
        s.message_count
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      WHERE s.id = ?
    `
      )
      .get(sessionId) as {
      session_id: string;
      project_id: string;
      project_name: string;
      started_at: string;
      ended_at: string | null;
      git_branch: string | null;
      message_count: number;
    } | null;

    if (!sessionRow) return null;

    const convRow = this.db
      .query(
        `
      SELECT substr(conversation_markdown, ?, COALESCE(?, length(conversation_markdown))) AS text
      FROM conversations
      WHERE session_id = ?
    `
      )
      .get(offset + 1, limit ?? null, sessionId) as { text: string } | null;
    const conversationText = convRow?.text ?? null;

    return {
      sessionId: sessionRow.session_id,
      projectId: sessionRow.project_id,
      projectName: sessionRow.project_name,
      startedAt: sessionRow.started_at,
      endedAt: sessionRow.ended_at,
      gitBranch: sessionRow.git_branch,
      messageCount: sessionRow.message_count,
      conversationText,
    };
  }

  listSessions(
    project?: string,
    date?: string,
    limit: number = 50
  ): SessionListEntry[] {
    let sql = `
      SELECT
        s.id AS session_id,
        s.project_id,
        p.display_name AS project_name,
        s.started_at,
        s.ended_at,
        s.git_branch,
        s.message_count,
        j.headline AS journal_headline,
        j.date AS journal_date
      FROM sessions s
      JOIN projects p ON p.id = s.project_id
      LEFT JOIN journal_entries j ON (
        j.project_id = s.project_id
        AND j.session_ids LIKE '%' || s.id || '%'
      )
      WHERE 1=1
    `;
    const params: (string | number)[] = [];

    if (project) {
      sql += ` AND (s.project_id = ? OR p.display_name LIKE ?)`;
      params.push(project, `%${project}%`);
    }

    if (date) {
      sql += ` AND date(s.started_at) = ?`;
      params.push(date);
    }

    sql += ` ORDER BY s.started_at DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.query(sql).all(...params) as Array<{
      session_id: string;
      project_id: string;
      project_name: string;
      started_at: string;
      ended_at: string | null;
      git_branch: string | null;
      message_count: number;
      journal_headline: string | null;
      journal_date: string | null;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      projectId: row.project_id,
      projectName: row.project_name,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      gitBranch: row.git_branch,
      messageCount: row.message_count,
      journalHeadline: row.journal_headline,
      journalDate: row.journal_date,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function safeParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// Extracts a short snippet of text around the first match of the query
function extractSnippet(text: string, query: string, radius: number = 150): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + query.length + radius);
  const snippet = text.slice(start, end);
  return (start > 0 ? "…" : "") + snippet + (end < text.length ? "…" : "");
}
