// ABOUTME: SQLite connection and query interface
// ABOUTME: Provides read-only access to engineering-notebook session history database

export interface SessionQuery {
  sessionId: string;
  host: string;
  timestamp: number;
}
