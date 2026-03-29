# Recall — MCP Server for Session History Search

## Purpose

Read-only MCP server that gives Claude access to engineering-notebook's session
history database. Replaces the search capability previously provided by the
episodic-memory plugin, backed by engineering-notebook's multi-host aggregated data.

This tool is for Claude, not humans. Engineering-notebook's web UI and
agent-board-tui serve the human interface.

## Data Source

SQLite database at `~/.config/engineering-notebook/notebook.db` (configurable).
Read-only access. WAL mode handles concurrent reads with the web server.

### Available Data

| Table | Contents |
|-------|----------|
| `journal_entries` | Haiku-generated summaries: headline, summary, topics, open_questions, date, project |
| `conversations` | Full cleaned conversation markdown per session (tool calls stripped) |
| `sessions` | Metadata: project, dates, git branch, version, parent session, subagent flag |
| `projects` | Project display names, session counts |

## MCP Tools

### 1. `search`

Search across journal summaries and conversation text.

**Input:**
- `query` (string, required) — search terms
- `project` (string, optional) — filter by project name
- `limit` (number, optional, default 10) — max results

**Behavior:**
1. Search `journal_entries` (headline, summary, topics) first — fast, high signal
2. If insufficient results, search `conversations.conversation_markdown` — slower, deeper
3. Return results ranked by relevance

**Output:** Array of matches:
```json
{
  "session_id": "uuid",
  "project": "claudes-home",
  "date": "2026-03-27",
  "headline": "Set up engineering-notebook...",
  "summary": "...",
  "topics": ["engineering-notebook", "session-history"],
  "snippet": "...matching text excerpt...",
  "source": "summary" | "conversation"
}
```

### 2. `read_session`

Read the full conversation for a specific session.

**Input:**
- `session_id` (string, required)
- `offset` (number, optional, default 0) — character offset for large sessions
- `limit` (number, optional, default 50000) — character limit

**Output:**
```json
{
  "session_id": "uuid",
  "project": "claudes-home",
  "date": "2026-03-27",
  "git_branch": "main",
  "message_count": 42,
  "conversation": "**Jerry (09:15):** Morning chief\n**Claude (09:15):** ..."
}
```

### 3. `list_sessions`

Browse sessions by date and/or project.

**Input:**
- `project` (string, optional)
- `date` (string, optional) — YYYY-MM-DD
- `limit` (number, optional, default 20)

**Output:** Array of session summaries with metadata and headline (if summarized).

## Tech Stack

- **Runtime:** Bun (matches engineering-notebook)
- **MCP SDK:** `@modelcontextprotocol/sdk`
- **Database:** `bun:sqlite` (read-only)
- **Transport:** stdio (standard MCP server)

## Project Structure

```
recall/
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── db.ts             # SQLite connection and queries
│   ├── tools/
│   │   ├── search.ts     # search tool
│   │   ├── read.ts       # read_session tool
│   │   └── list.ts       # list_sessions tool
│   └── config.ts         # Config loading (db path)
├── package.json
├── tsconfig.json
├── CLAUDE.md
└── PLAN.md
```

## Configuration

Server reads db path from (in order):
1. `RECALL_DB_PATH` environment variable
2. `~/.config/engineering-notebook/notebook.db` (default)

## Installation

Add to `~/.claude/settings.json` or project `.mcp.json`:
```json
{
  "mcpServers": {
    "recall": {
      "command": "bun",
      "args": ["run", "/path/to/recall/src/index.ts"]
    }
  }
}
```

## Implementation Order

1. Project scaffolding (package.json, tsconfig, CLAUDE.md)
2. Database connection module (read-only SQLite)
3. `search` tool — journal entries first, then conversation fallback
4. `read_session` tool
5. `list_sessions` tool
6. MCP server wiring (stdio transport)
7. Test with Claude Code
8. Add to global MCP config

## Design Decisions

- **No embeddings / vector search.** SQLite FTS5 is sufficient. Journal summaries
  provide structured search targets. If FTS proves inadequate, we can add it later.
- **Read-only.** This server never writes to the database. Ingestion and summarization
  are engineering-notebook's job.
- **Terse output.** This is for Claude, not humans. Return structured data, not prose.
- **Character limits on read.** Large sessions (200KB+) need chunked reading to avoid
  blowing up context windows.
