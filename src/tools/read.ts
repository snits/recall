// ABOUTME: Read session tool
// ABOUTME: Retrieves full session content by session ID and host

export interface ReadRequest {
  sessionId: string;
  host: string;
}

export interface SessionContent {
  sessionId: string;
  host: string;
  timestamp: number;
  content: string;
}
