// ABOUTME: List sessions tool
// ABOUTME: Retrieves available sessions from the database with filtering options

export interface ListRequest {
  host?: string;
  limit?: number;
  offset?: number;
}

export interface SessionInfo {
  sessionId: string;
  host: string;
  timestamp: number;
}
