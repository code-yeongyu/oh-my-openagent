import type { RuleFileCandidate, RuleMetadata } from "@oh-my-opencode/rules-engine";

export type { RuleFileCandidate, RuleMetadata };

export interface RuleInfo {
  path: string;
  relativePath: string;
  distance: number;
  content: string;
  contentHash: string;
  metadata: RuleMetadata;
  matchReason: string;
  realPath: string;
}

export interface InjectedRulesData {
  sessionID: string;
  injectedHashes: string[];
  injectedRealPaths: string[];
  updatedAt: number;
}
