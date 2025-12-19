/**
 * Git Safety Validator Types
 *
 * Types for git operation safety validation.
 * Part of LIF-63: Hook Reliability, Safety & Orchestration Guardrails
 */

/**
 * Configuration for the Git Safety Validator hook
 */
export interface GitSafetyConfig {
  /** Protected branches that cannot be force-pushed to (default: ['main', 'master']) */
  protectedBranches: string[];
  /** Block force push operations entirely (default: true) */
  blockForceOperations: boolean;
  /** Warn on destructive operations like reset --hard (default: true) */
  warnOnDestructive: boolean;
  /** Regex patterns to allow (skip validation) */
  allowListPatterns: string[];
}

/**
 * Result of git command validation
 */
export interface GitSafetyResult {
  /** Whether the operation is allowed */
  allowed: boolean;
  /** Reason for blocking/warning */
  reason?: string;
  /** Suggested alternative action */
  suggestion?: string;
  /** Whether user confirmation is required */
  requiresConfirmation?: boolean;
  /** Severity level */
  severity?: "block" | "warn" | "info";
}

/**
 * Parsed git command information
 */
export interface ParsedGitCommand {
  /** The git subcommand (push, reset, etc.) */
  subcommand: string;
  /** Command flags */
  flags: string[];
  /** Command arguments */
  args: string[];
  /** Raw command string */
  raw: string;
  /** Whether this is a force operation */
  isForce: boolean;
  /** Target branch if applicable */
  targetBranch?: string;
}
