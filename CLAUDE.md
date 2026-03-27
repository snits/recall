# Recall

Read-only MCP server providing Claude with search access to engineering-notebook's
session history database. Searches journal summaries and full conversation text
across sessions from multiple hosts.

## PROJECT SCALE CONTEXT

- **Users:** Single user (Jerry), single AI consumer (Claude)
- **Tool type:** MCP server (stdio transport)
- **Codebase size:** Small (~200 LOC expected)
- **Complexity:** Low — read-only SQLite queries, no state management
- **Process overhead:** Minimal — this is a straightforward utility
- **Default approach:** Pragmatic, ship it fast, iterate if needed

## Tech Stack

- Bun runtime
- @modelcontextprotocol/sdk
- bun:sqlite (read-only)

## Conventions

- Match engineering-notebook's TypeScript style where applicable
- No unnecessary abstractions — this is a thin query layer over SQLite
- All database access is read-only

## Testing

- Integration tests against a test SQLite database with known fixture data
- No mocks — test against real SQLite
