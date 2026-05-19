export interface RuleMetadata {
  readonly description?: string;
  readonly globs?: string | readonly string[];
  readonly paths?: string | readonly string[];
  readonly applyTo?: string | readonly string[];
  readonly alwaysApply?: boolean;
}

export interface RuleFrontmatterResult {
  readonly metadata: RuleMetadata;
  readonly body: string;
}

export interface RuleFileCandidate {
  readonly path: string;
  readonly realPath: string;
  readonly isGlobal: boolean;
  readonly distance: number;
  readonly relativePath: string;
  readonly source: RuleSource;
  readonly isSingleFile?: boolean;
}

export type RuleSource =
  | ".omo/rules"
  | ".claude/rules"
  | ".cursor/rules"
  | ".github/instructions"
  | ".github/copilot-instructions.md"
  | "~/.omo/rules"
  | "~/.opencode/rules"
  | "~/.claude/rules";

export interface MatchResult {
  readonly applies: boolean;
  readonly reason?: string;
}

export interface DirectoryScanEntry {
  readonly path: string;
  readonly realPath: string;
  readonly relativePath: string;
}

export interface RuleScanCacheStats {
  readonly candidateEntries: number;
  readonly directoryEntries: number;
}

export interface RuleScanCache {
  get(key: string): readonly RuleFileCandidate[] | undefined;
  set(key: string, value: readonly RuleFileCandidate[]): void;
  getDirScan(dir: string): readonly DirectoryScanEntry[] | undefined;
  setDirScan(dir: string, entries: readonly DirectoryScanEntry[]): void;
  stats(): RuleScanCacheStats;
  clear(): void;
}

export interface FindRuleFilesOptions {
  readonly skipClaudeUserRules?: boolean;
}

export interface AgentsMdCache {
  get(key: string): readonly string[] | undefined;
  set(key: string, value: readonly string[]): void;
  clear(): void;
}
