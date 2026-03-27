// ABOUTME: Search tool for engineering-notebook sessions
// ABOUTME: Searches journal summaries and conversation text across session history

export interface SearchQuery {
  query: string;
  limit?: number;
}

export interface SearchResult {
  sessionId: string;
  host: string;
  timestamp: number;
  relevance: number;
}
