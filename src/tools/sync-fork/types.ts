/**
 * Sync Fork Tool - TypeScript Interfaces
 *
 * Defines all data structures for the AI-agent-driven sync workflow.
 */

/* --- State File Types (P0 - Required) --- */

/**
 * Sync fork state file - tracks recurring workflow progress
 * Location: .opencode/state/sync-fork.json
 */
export interface SyncForkState {
  /** Schema version for migrations */
  version: 1

  /** Upstream repository configuration */
  upstream: {
    remote: string // "upstream"
    branch: string // "main"
    lastFetchedAt: string // ISO-8601
  }

  /** Last commit that was reviewed (regardless of outcome) */
  lastReviewedCommit: string | null
  lastReviewedAt: string | null

  /** Individual commit statuses */
  commits: Record<string, CommitStatus>
}

/**
 * Status of a single commit in the state file
 */
export interface CommitStatus {
  /** Current status of this commit */
  status: "synced" | "skipped" | "reviewed" | "pending"

  /** PR number if synced */
  pr?: string

  /** Reason if skipped */
  reason?: string

  /** AI recommendation if reviewed */
  recommendation?: Priority | "Skip"

  /** When this commit was reviewed */
  reviewedAt: string

  /** Linear issue if created */
  linearIssue?: string
}

/* --- Parsed Commit Types --- */

/**
 * A parsed commit from git log
 */
export interface ParsedCommit {
  sha: string
  shortSha: string
  type: CommitType
  scope?: string
  subject: string
  body?: string
  author: string
  date: string // ISO-8601
  files: FileChange[]
  isBreaking: boolean
  isMerge: boolean
  prNumber?: string
}

/**
 * Conventional commit types
 */
export type CommitType =
  | "feat"
  | "fix"
  | "perf"
  | "security"
  | "refactor"
  | "test"
  | "docs"
  | "chore"
  | "build"
  | "ci"
  | "style"
  | "revert"
  | "other"

/**
 * A file change in a commit
 */
export interface FileChange {
  path: string
  status: "A" | "M" | "D" | "R" | "C"
  additions?: number
  deletions?: number
}

/* --- AI Analysis Types --- */

/**
 * Priority levels for recommendations
 */
export type Priority = "P0" | "P1" | "P2" | "P3"

/**
 * Result from AI analysis of a commit
 */
export interface AIAnalysisResult {
  /** Commit being analyzed */
  commitSha: string

  /** AI-determined priority */
  priority: Priority | "Skip"

  /** AI reasoning (2-3 sentences) */
  reasoning: string

  /** Conflict likelihood assessment */
  conflictLikelihood: "likely" | "possible" | "unlikely"

  /** Recommended action */
  action: "sync_immediately" | "queue_for_batch" | "skip"

  /** Affected areas in the codebase */
  affectedAreas: string[]
}

/* --- Recommendation Types (Output for OmO) --- */

/**
 * A sync recommendation - each one = potential Linear issue
 * Ready for linear_create_issue consumption
 */
export interface SyncRecommendation {
  /** Unique group identifier */
  groupId: string

  /** Ready-to-use Linear issue title */
  suggestedIssueTitle: string

  /** Markdown description for Linear issue body */
  suggestedIssueDescription: string

  /** Commits in cherry-pick order */
  commits: ParsedCommit[]

  /** AI-determined priority */
  priority: Priority

  /** AI reasoning for this priority */
  reasoning: string

  /** Suggested Linear labels */
  suggestedLabels: string[]

  /** Estimated effort */
  estimatedEffort: "trivial" | "small" | "medium" | "large"

  /** Ready-to-run cherry-pick command */
  cherryPickCommand: string

  /** Risk assessment from AI */
  riskSummary: {
    level: "HIGH" | "MEDIUM" | "LOW"
    conflictLikelihood: "likely" | "possible" | "unlikely"
    affectedAreas: string[]
  }
}

/* --- Tool Arguments & Result --- */

/** Valid filter types for commit filtering */
export type FilterType = "fix" | "perf" | "security" | "feat"

/**
 * Arguments for the sync_fork tool
 */
export interface SyncForkArgs {
  /** Filter commits by type(s) - can be comma-separated string or "all" */
  filter?: string

  /** Only commits since date (ISO-8601) */
  since?: string

  /** Max commits to analyze */
  limit?: number

  /** Output format */
  output?: "json" | "markdown"

  /** Generate cherry-pick commands without executing */
  scaffold?: boolean

  /** Clear state file and start fresh */
  resetState?: boolean

  /** Analyze only, don't execute anything */
  dryRun?: boolean
}

/**
 * Data for creating Linear issues from recommendations
 */
export interface LinearIssueData {
  title: string
  description: string
  labels: string[]
  priority: string
}

/**
 * Result from the sync_fork tool
 */
export interface SyncForkResult {
  success: boolean

  /** Summary statistics */
  summary?: {
    total: number
    new: number
    byPriority: Record<string, number>
    byType: Record<string, number>
  }

  /** Primary output for OmO consumption */
  recommendations?: SyncRecommendation[]

  /** Human-readable report */
  markdownReport?: string

  /** Error if failed */
  error?: string

  /** Suggestions for next steps */
  nextSteps?: string[]

  /** Linear issues data for P0/P1 recommendations */
  linearIssuesData?: LinearIssueData[]
}

/* --- Git Context Types --- */

/**
 * Git repository context for the sync operation
 */
export interface GitContext {
  /** Repository root path */
  repoRoot: string

  /** Upstream remote name */
  upstreamRemote: string

  /** Upstream branch name */
  upstreamBranch: string

  /** Current HEAD commit */
  headCommit: string

  /** Merge base between HEAD and upstream */
  mergeBase: string

  /** Whether repo is in a worktree */
  isWorktree: boolean

  /** Whether repo is shallow */
  isShallow: boolean

  /** Whether working tree is dirty */
  isDirty: boolean

  /** Whether HEAD is detached */
  isDetached: boolean
}

/**
 * Preflight check result
 */
export interface PreflightResult {
  success: boolean
  context?: GitContext
  warnings: string[]
  errors: string[]
  suggestions: string[]
}
