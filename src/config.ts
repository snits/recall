// ABOUTME: Configuration loading and management
// ABOUTME: Loads database path and runtime configuration from environment

export interface Config {
  databasePath: string;
}

export function loadConfig(): Config {
  return {
    databasePath: "",
  };
}
