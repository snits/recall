// ABOUTME: Configuration loading for the recall MCP server
// ABOUTME: Resolves the database path from environment or default location

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
