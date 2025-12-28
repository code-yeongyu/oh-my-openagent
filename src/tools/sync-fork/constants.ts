import type { CommitType } from "./types"

export const SYNC_FORK_DESCRIPTION = `Analyze upstream-only commits and generate prioritized sync recommendations.

This tool uses AI agents to intelligently analyze upstream changes, determine what's valuable for your fork, and automate the sync process from discovery to PR creation.

**Workflow**:
1. Discovery: Load state, fetch upstream, get new commits
2. AI Analysis: Agents evaluate each commit for value and conflict risk
3. Recommendations: Prioritized list with reasoning
4. Execution: Cherry-pick, create PR, create Linear issues

**Options**:
- filter: Filter by commit type (all|fix|perf|security|feat)
- since: Only commits since date (ISO-8601)
- limit: Max commits to analyze (default: 50)
- output: Format (json|markdown)
- scaffold: Generate commands without executing
- resetState: Clear state file and start fresh
- dryRun: Analyze only, don't execute

Returns JSON with recommendations that can be directly used to create Linear issues.`

export const STATE_FILE_PATH = ".opencode/state/sync-fork.json"

export const DEFAULT_UPSTREAM_REMOTE = "upstream"
export const DEFAULT_UPSTREAM_BRANCH = "main"
export const FALLBACK_UPSTREAM_BRANCHES = ["main", "master"]

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 200

export const SECURITY_KEYWORDS = [
  "cve",
  "vulnerability",
  "exploit",
  "auth bypass",
  "injection",
  "xss",
  "csrf",
  "ssrf",
  "rce",
  "privilege",
  "token",
  "secret",
  "hardening",
  "security",
  "sanitize",
  "escape",
]

export const FILE_RISK_HINTS = {
  HIGH: [
    "src/index.ts",
    "src/config/schema.ts",
    "src/agents/omo.ts",
    "src/hooks/governance-*",
    "src/auth/**",
  ],
  MEDIUM: [
    "src/agents/**",
    "src/tools/**",
    "src/features/**",
    "src/hooks/**",
    "src/mcp/**",
    "src/shared/**",
  ],
  LOW: ["docs/**", "tests/**", "changelog/**", "*.md"],
}

export const COMMIT_TYPE_PATTERNS: Record<string, CommitType> = {
  feat: "feat",
  feature: "feat",
  fix: "fix",
  bug: "fix",
  perf: "perf",
  performance: "perf",
  security: "security",
  sec: "security",
  refactor: "refactor",
  test: "test",
  tests: "test",
  docs: "docs",
  doc: "docs",
  chore: "chore",
  build: "build",
  ci: "ci",
  style: "style",
  revert: "revert",
}

export const PRIORITY_LABELS: Record<string, string[]> = {
  P0: ["sync-upstream", "P0", "critical"],
  P1: ["sync-upstream", "P1", "high"],
  P2: ["sync-upstream", "P2", "medium"],
  P3: ["sync-upstream", "P3", "low"],
}

export const GIT_LOG_FORMAT = "%H%x1f%an%x1f%ad%x1f%s%x1f%P%x1e"
export const GIT_DATE_FORMAT = "iso-strict"
