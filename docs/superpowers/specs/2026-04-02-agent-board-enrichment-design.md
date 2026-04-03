# Agent-Board Enrichment for read_session

## Problem

Recall's `read_session` tool returns conversation text from engineering-notebook's
SQLite database, but engineering-notebook has a parser bug that prevents subagent
session ingestion (0 of 3,146 subagent files ingested). Subagent conversations
from design reviews, research tasks, and code exploration are invisible to recall
search results. Agent-board-tui's preprocessed data store already has this data
in a structured format, indexed by the same session UUID.

## Approach

Enhance `read_session` to use agent-board's preprocessed data as the preferred
source for conversation content, falling back to engineering-notebook for sessions
agent-board hasn't processed. This bridges the subagent visibility gap without
modifying engineering-notebook's ingest pipeline.

## Data Source Roles

| Source | Role | Coverage |
|--------|------|----------|
| engineering-notebook (notebook.db) | Session metadata, search/discovery, journal summaries | 15,604 sessions across multiple hosts |
| agent-board (`~/.local/share/agent-board/sessions/`) | Conversation content, subagent data | ~2,800 sessions on local host (active + archived) |

Engineering-notebook has wider coverage (multi-host rsync, historical bulk ingest).
Agent-board has richer per-session data (subagent messages, agent types, tool use
summaries). 2,704 sessions overlap between the two.

## Design

### New Module: `src/agent-board.ts`

Reads from the agent-board preprocessed data store. Base path defaults to
`~/.local/share/agent-board` with `AGENT_BOARD_PATH` env var override.

**`AgentBoardReader` class:**

- `constructor(basePath?: string)` -- uses env var or default
- `getSessionData(sessionId: string): { roster: AgentInfo[], messages: Message[] } | null` -- reads `sessions/{sessionId}/session.json` and `messages.json`, returns null if session directory doesn't exist
- `formatConversation(messages: Message[], agentId?: string, offset?: number, limit?: number): string` -- filters messages by agentId and formats as conversation markdown. When agentId is omitted, selects messages where `agentId === null` (the main conversation). When agentId is provided, selects messages matching that agent. Applies character offset/limit for chunking.

**Conversation markdown format** (matches engineering-notebook style):

```markdown
## User

<message content>

## Assistant

<message content>
> Tool: Read src/db.ts
> Tool: Bash (Run tests)

<message content>
```

Tool use summaries are included as blockquote lines between message content blocks
since they provide useful context about what the agent did.

**Types:**

```typescript
interface AgentInfo {
  agentId: string;
  type: string;
  messageCount: number;
}

interface Message {
  uuid: string;
  agentId: string | null;
  role: "user" | "assistant";
  content: string;
  toolUse: ToolUseSummary[];
  timestamp: string;
  agentType: string | null;
}

interface ToolUseSummary {
  tool: string;
  input: Record<string, unknown>;
  summary: string;
}
```

### Changes to `read_session` Tool

**New optional parameter:** `agent_id` (string) -- when provided, returns that
specific subagent's conversation instead of the main session conversation.

**Updated flow:**

1. Query notebook.db for session metadata (project, date, git branch, message count)
2. If session not found in notebook.db, return error (unchanged behavior)
3. Query agent-board for session data (roster + messages)
4. **If `agent_id` is omitted:**
   - Conversation content: prefer agent-board formatted markdown if available,
     fall back to notebook.db `conversation_markdown`
   - Include agent roster in response (`agents` field, empty array if no agent-board data)
5. **If `agent_id` is provided:**
   - Requires agent-board data; return error if unavailable
   - Filter messages to the specified agent, format as markdown
   - Return agent metadata (type, message count) alongside conversation

**Response shape (no agent_id):**

```json
{
  "session_id": "abc-123",
  "project": "recall",
  "date": "2026-03-28",
  "git_branch": "main",
  "message_count": 42,
  "conversation": "## User\n...",
  "agents": [
    { "agent_id": "aa4", "type": "Explore", "message_count": 116 },
    { "agent_id": "b7d", "type": "web-search-researcher", "message_count": 30 }
  ]
}
```

**Response shape (with agent_id):**

```json
{
  "session_id": "abc-123",
  "agent_id": "aa4",
  "agent_type": "Explore",
  "message_count": 116,
  "conversation": "## User\n<agent prompt>\n\n## Assistant\n<agent response>..."
}
```

### Graceful Degradation

- Agent-board base directory doesn't exist: `agents: []`, conversation from notebook.db
- `session.json` or `messages.json` missing for a session: same fallback behavior
- `agent_id` requested but agent-board has no data for session: error "Subagent data not available for this session"
- `agent_id` not found in roster: error "Agent not found for this session"
- Malformed JSON in agent-board files: log warning, fall back to notebook.db

### No Changes To

- `src/db.ts` -- RecallDatabase class untouched
- `search` tool -- still searches notebook.db journal entries and conversations
- `list_sessions` tool -- still lists from notebook.db

### Configuration

- `AGENT_BOARD_PATH` env var overrides the default agent-board data directory
- Default: `~/.local/share/agent-board`
- The recall MCP server's existing `NOTEBOOK_DB_PATH` env var (if any) is unaffected

## Testing

Integration tests against fixture data:

- Create test fixture with agent-board directory structure:
  - `sessions/{id}/session.json` with agent roster
  - `sessions/{id}/messages.json` with main + subagent messages
- Test `read_session` prefers agent-board conversation when available
- Test `read_session` falls back to notebook.db when agent-board lacks the session
- Test `agent_id` parameter returns filtered subagent conversation
- Test `agent_id` with unknown agent returns error
- Test `agent_id` when agent-board lacks session returns error
- Test `agents` roster is always present (empty array when no agent-board data)
- Test conversation markdown formatting matches expected output
- Test offset/limit chunking works for agent conversations
- Test graceful handling of missing/malformed agent-board files

All tests against real data (SQLite + filesystem), no mocks.

## Scope Boundaries

**In scope:**
- `agent-board.ts` module for reading preprocessed data
- Enhanced `read_session` tool with agent-board integration
- Tests for the above

**Out of scope (separate issues):**
- Fixing engineering-notebook's parser bug for subagent ingestion
- Enhancing `search` to search agent-board conversation content
- Enhancing `list_sessions` to show agent counts
- Archiving subagent directories alongside main session files
