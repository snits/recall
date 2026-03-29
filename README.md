# Recall

Read-only MCP server that gives Claude access to
[engineering-notebook](https://github.com/jsnitsel/engineering-notebook)'s
session history database. Searches journal summaries and full conversation
text across sessions from multiple hosts.

This tool is for Claude, not humans. Engineering-notebook's web UI serves the
human interface.

## Prerequisites

- [Bun](https://bun.sh/) v1.1+
- [engineering-notebook](https://github.com/jsnitsel/engineering-notebook)
  installed and populated with session data
- SQLite database at `~/.config/engineering-notebook/notebook.db` (created by
  engineering-notebook's ingest process)

## Installation

```bash
git clone https://github.com/jsnitsel/recall.git
cd recall
bun install
```

Add to your Claude Code MCP configuration (`~/.claude/settings.json` or
project `.mcp.json`):

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

## Configuration

The database path is resolved in order:

1. `RECALL_DB_PATH` environment variable
2. `~/.config/engineering-notebook/notebook.db` (default)

## MCP Tools

### `search`

Search across journal summaries and conversation text.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `query` | string | yes | — | Search terms |
| `project` | string | no | — | Filter by project name |
| `limit` | number | no | 10 | Max results |

Searches journal entries (headline, summary, topics) first for speed, then
falls back to full conversation text for deeper matches.

### `read_session`

Read the full conversation for a specific session.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `session_id` | string | yes | — | Session UUID |
| `offset` | number | no | 0 | Character offset for large sessions |
| `limit` | number | no | 50000 | Character limit per chunk |

### `list_sessions`

Browse sessions by date and/or project.

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `project` | string | no | — | Filter by project name |
| `date` | string | no | — | Filter by date (YYYY-MM-DD) |
| `limit` | number | no | 20 | Max results |

## Data Source

Recall reads from engineering-notebook's SQLite database (read-only, WAL mode):

| Table | Contents |
|-------|----------|
| `journal_entries` | LLM-generated summaries: headline, summary, topics, open questions |
| `conversations` | Full cleaned conversation markdown (tool calls stripped) |
| `sessions` | Metadata: project, dates, git branch, message count, subagent flag |
| `projects` | Project names and session counts |

## Tech Stack

- **Runtime:** [Bun](https://bun.sh/)
- **MCP SDK:** [@modelcontextprotocol/sdk](https://www.npmjs.com/package/@modelcontextprotocol/sdk)
- **Database:** bun:sqlite (read-only)
- **Transport:** stdio

## License

[MIT](LICENSE)
