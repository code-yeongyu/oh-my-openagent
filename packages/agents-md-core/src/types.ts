import type { AgentsMdCache } from "@oh-my-opencode/rules-core";

export interface TruncationResult {
  readonly result: string;
  readonly truncated: boolean;
}

export interface AgentsMdTruncator {
  truncate(sessionID: string, content: string): Promise<TruncationResult>;
}

export interface AgentsMdContextOutput {
  readonly title: string;
  output: string;
  readonly metadata: unknown;
}

export interface AgentsMdInjectedPathsStorage {
  loadInjectedPaths(sessionID: string): Set<string>;
  saveInjectedPaths(sessionID: string, paths: Set<string>): void;
}

export interface AgentsMdDiscoveryInput {
  readonly startDir: string;
  readonly rootDir: string;
  readonly cache?: AgentsMdCache;
}
