/**
 * Rule file metadata (Claude Code style frontmatter)
 * @see https://docs.anthropic.com/en/docs/claude-code/settings#rule-files
 */
export interface RuleMetadata {
  description?: string;
  globs?: string | string[];
  alwaysApply?: boolean;
}

/**
 * Rule information with path context and content
 */
export interface RuleInfo {
  /** Absolute path to the rule file */
  path: string;
  /** Path relative to project root */
  relativePath: string;
  /** Directory distance from target file (0 = same dir) */
  distance: number;
  /** Rule file content (without frontmatter) */
  content: string;
  /** SHA-256 hash of content for deduplication */
  contentHash: string;
  /** Parsed frontmatter metadata */
  metadata: RuleMetadata;
  /** Why this rule matched (e.g., "alwaysApply", "glob: *.ts", "path match") */
  matchReason: string;
  /** Real path after symlink resolution (for duplicate detection) */
  realPath: string;
}

/**
 * Session storage for injected rules tracking
 */
export interface InjectedRulesData {
  sessionID: string;
  /** Content hashes of already injected rules */
  injectedHashes: string[];
  /** Real paths of already injected rules (for symlink deduplication) */
  injectedRealPaths: string[];
  updatedAt: number;
}
