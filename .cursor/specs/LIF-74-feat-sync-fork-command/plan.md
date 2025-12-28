# Sync Fork Command - Implementation Plan

**Linear Issue**: [LIF-74](https://linear.app/lifelogger/issue/LIF-74/sync-fork-command-recurring-workflow-for-upstream-synchronization)
**Created**: 2025-12-28
**Author**: Strategic Planner (OmO)

## Summary

Implement `/sync-fork` command as an AI-agent-driven tool that uses **AI agents for analysis** (not mathematical formulas), maintains **state file for recurring workflows**, and integrates with **Linear for issue creation**. The command follows a 4-phase architecture: Discovery → AI Analysis → Recommendations → Execution.

**Key Design Decisions from Spec**:
- DD-1: AI agents evaluate commits (no scoring formulas)
- DD-2: State tracking is P0 (required, not optional)
- DD-3: Humans review at PR stage (not individual commits)
- DD-4: No offline mode (git fetch requires network anyway)

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Files** | `src/tools/sync-fork/`, `.opencode/command/sync-fork.md` |
| **Dependencies** | Git CLI, gh CLI (for PR creation) |
| **State File** | `.opencode/state/sync-fork.json` |
| **Testing** | Manual dogfooding (test framework not configured) |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| I. Plugin-First Architecture | ✅ Tool via @opencode-ai/plugin SDK |
| II. Multi-Model Excellence | ✅ Uses explore agent for commit analysis |
| III. Multi-Layered Agent Orchestration | ✅ Command → Tool → background_task(explore) |
| IV. Bun-Native Development | ✅ Bun only, uses Bun.spawn for CLI |
| V. Hook-Driven Enhancement | ⚠️ Tool-based (hooks could extend later) |
| VI. Dogfooding | ✅ Will test on oh-my-opencode upstream sync |
| VII. GitHub Actions Publishing Only | ✅ No publishing changes |

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    /sync-fork Command                            │
│                  (.opencode/command/sync-fork.md)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    sync_fork Tool                                │
│                  (src/tools/sync-fork/)                          │
├─────────────────────────────────────────────────────────────────┤
│  index.ts       │ Tool registration, exports                    │
│  types.ts       │ TypeScript interfaces                         │
│  constants.ts   │ Config defaults, risk patterns                │
│  tools.ts       │ Main tool implementation                      │
│  state.ts       │ State file management (atomic writes)         │
│  git-adapter.ts │ Git CLI operations (side effects)             │
│  analysis.ts    │ AI agent orchestration for commit analysis    │
│  report.ts      │ Recommendation formatting                     │
│  execution.ts   │ Cherry-pick and PR creation                   │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐   ┌────────────┐   ┌────────────┐
     │ State File │   │ Git CLI    │   │ Explore    │
     │ (JSON)     │   │ Operations │   │ Agent      │
     └────────────┘   └────────────┘   └────────────┘
```

### Data Flow (4 Phases from Spec)

```
Phase 1: Discovery (Git Operations)
┌─────────────────────────────────────────────────────────────────┐
│  1. Load state file → Get lastReviewedCommit                    │
│  2. git fetch upstream                                          │
│  3. git log --since={lastReviewed}..upstream/main               │
│  4. Group commits by PR/scope                                   │
│  Output: CommitGroup[] to analyze                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 2: AI Analysis (Parallel Agents)
┌─────────────────────────────────────────────────────────────────┐
│  For each commit group:                                         │
│    background_task(agent="explore", prompt="""                  │
│      UPSTREAM CHANGE:                                           │
│      - Commit: {sha}, Message: {message}                        │
│      - Files changed: {files}, Diff: {diff}                     │
│                                                                 │
│      FORK CONTEXT:                                              │
│      - Our version of changed files: {fork_files}               │
│                                                                 │
│      EVALUATE:                                                  │
│      1. Does this fix a bug we might have?                      │
│      2. Does this add functionality we'd benefit from?          │
│      3. Does this conflict with our customizations?             │
│      4. What's the risk level of integrating this?              │
│                                                                 │
│      OUTPUT: Priority (P0-P3/Skip), Reasoning, Conflict risk    │
│    """)                                                         │
│                                                                 │
│  Collect results with background_output                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 3: Recommendations Report
┌─────────────────────────────────────────────────────────────────┐
│  - Group by priority (P0 → P3 → Skip)                           │
│  - Include AI reasoning for each                                │
│  - Show conflict warnings                                       │
│  - Present to user for approval                                 │
│  Output: SyncRecommendation[] (ready for Linear issue creation) │
└─────────────────────────────────────────────────────────────────┘
                              │
                    User approves ▼
Phase 4: Execution (AI-driven)
┌─────────────────────────────────────────────────────────────────┐
│  1. git checkout -b sync/upstream-{date}                        │
│  2. git cherry-pick -x {commits}                                │
│  3. Handle conflicts (flag for manual if can't resolve)         │
│  4. git push origin {branch}                                    │
│  5. gh pr create with summary                                   │
│  6. linear_create_issue for each P0/P1 recommendation           │
│  7. Update state file with synced commits                       │
│                                                                 │
│  Human reviews PR ← FINAL GATE                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Data Models

### State File Structure (P0 - Required)

```typescript
// types.ts

/**
 * Sync fork state file - tracks recurring workflow progress
 * Location: .opencode/state/sync-fork.json
 */
export interface SyncForkState {
  /** Schema version for migrations */
  version: 1
  
  /** Upstream repository configuration */
  upstream: {
    remote: string           // "upstream"
    branch: string           // "main"
    lastFetchedAt: string    // ISO-8601
  }
  
  /** Last commit that was reviewed (regardless of outcome) */
  lastReviewedCommit: string | null
  lastReviewedAt: string | null
  
  /** Individual commit statuses */
  commits: Record<string, CommitStatus>
}

export interface CommitStatus {
  /** Current status of this commit */
  status: "synced" | "skipped" | "reviewed" | "pending"
  
  /** PR number if synced */
  pr?: string
  
  /** Reason if skipped */
  reason?: string
  
  /** AI recommendation if reviewed */
  recommendation?: "P0" | "P1" | "P2" | "P3" | "Skip"
  
  /** When this commit was reviewed */
  reviewedAt: string
  
  /** Linear issue if created */
  linearIssue?: string
}
```

### Parsed Commit

```typescript
export interface ParsedCommit {
  sha: string
  shortSha: string
  type: CommitType
  scope?: string
  subject: string
  body?: string
  author: string
  date: string        // ISO-8601
  files: FileChange[]
  isBreaking: boolean
  isMerge: boolean
  prNumber?: string
}

export type CommitType =
  | "feat" | "fix" | "perf" | "security"
  | "refactor" | "test" | "docs" | "chore"
  | "build" | "ci" | "style" | "revert" | "other"

export interface FileChange {
  path: string
  status: "A" | "M" | "D" | "R" | "C"
  additions?: number
  deletions?: number
}
```

### AI Analysis Result

```typescript
export interface AIAnalysisResult {
  /** Commit being analyzed */
  commitSha: string
  
  /** AI-determined priority */
  priority: "P0" | "P1" | "P2" | "P3" | "Skip"
  
  /** AI reasoning (2-3 sentences) */
  reasoning: string
  
  /** Conflict likelihood assessment */
  conflictLikelihood: "likely" | "possible" | "unlikely"
  
  /** Recommended action */
  action: "sync_immediately" | "queue_for_batch" | "skip"
  
  /** Affected areas in the codebase */
  affectedAreas: string[]
}
```

### Sync Recommendation (Output for OmO)

```typescript
/**
 * Each recommendation = potential Linear issue
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
  priority: "P0" | "P1" | "P2" | "P3"
  
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
```

### Tool Arguments & Result

```typescript
export interface SyncForkArgs {
  /** Filter commits by type */
  filter?: "all" | "fix" | "perf" | "security" | "feat"
  
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

export interface SyncForkResult {
  success: boolean
  
  /** Summary statistics */
  summary?: {
    total: number
    new: number  // Commits not in state file
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
}
```

## Module Responsibilities

| Module | Responsibility | Side Effects |
|--------|---------------|--------------|
| `state.ts` | State file read/write with atomic updates | YES (file I/O) |
| `git-adapter.ts` | Execute git commands | YES (git fetch, file reads) |
| `analysis.ts` | Orchestrate AI agents for commit analysis | YES (background_task calls) |
| `report.ts` | Format recommendations for output | NO (pure) |
| `execution.ts` | Cherry-pick, push, PR creation | YES (git, gh CLI) |
| `tools.ts` | Main tool orchestration | YES (calls all above) |

## File Risk Classification (AI Hints)

These are **hints for AI agents**, not rigid formulas:

```typescript
// constants.ts

export const FILE_RISK_HINTS = {
  HIGH: [
    "src/index.ts",           // Core plugin wiring
    "src/config/schema.ts",   // Config schema
    "src/agents/omo.ts",      // Main orchestrator
    "src/hooks/governance-*", // Security-critical
    "src/auth/**",            // Authentication
  ],
  MEDIUM: [
    "src/agents/**",          // Individual agents
    "src/tools/**",           // Individual tools
    "src/features/**",        // Features
    "src/hooks/**",           // Hooks
    "src/mcp/**",             // MCP integrations
    "src/shared/**",          // Shared utilities
  ],
  LOW: [
    "docs/**",                // Documentation
    "tests/**",               // Tests
    "changelog/**",           // Changelog
    "*.md",                   // Markdown files
  ],
}

export const SECURITY_KEYWORDS = [
  "cve", "vulnerability", "exploit", "auth bypass",
  "injection", "xss", "csrf", "ssrf", "rce",
  "privilege", "token", "secret", "hardening",
]
```

## Integration Points

### Existing Linear Tools

Leverage existing `src/tools/linear/` for issue creation:

```typescript
// From execution.ts
import { createIssue } from "../linear/api"

async function createLinearIssuesForRecommendations(
  recommendations: SyncRecommendation[],
  parentIssue?: string
): Promise<void> {
  for (const rec of recommendations.filter(r => ["P0", "P1"].includes(r.priority))) {
    await createIssue({
      title: rec.suggestedIssueTitle,
      description: rec.suggestedIssueDescription,
      teamName: "Lifelogger",
      labels: rec.suggestedLabels,
      parentId: parentIssue,  // Optional: group under parent issue
    })
  }
}
```

### State File Atomic Writes

Follow pattern from `src/features/context-learning/file-writer.ts`:

```typescript
// state.ts
import { rename, unlink, mkdir } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"

const STATE_FILE_PATH = ".opencode/state/sync-fork.json"

export async function atomicWriteState(state: SyncForkState): Promise<void> {
  const tempPath = `${STATE_FILE_PATH}.tmp.${Date.now()}`
  
  try {
    await mkdir(".opencode/state", { recursive: true })
    await Bun.write(tempPath, JSON.stringify(state, null, 2))
    await rename(tempPath, STATE_FILE_PATH)
  } catch (e) {
    try { await unlink(tempPath) } catch {}
    throw e
  }
}

export function readState(): SyncForkState | null {
  if (!existsSync(STATE_FILE_PATH)) return null
  try {
    return JSON.parse(readFileSync(STATE_FILE_PATH, "utf-8"))
  } catch {
    return null  // Corrupted state - start fresh
  }
}
```

### Background Task for AI Analysis

```typescript
// analysis.ts
import { backgroundTask } from "@opencode-ai/plugin"

export async function analyzeCommitWithAI(
  commit: ParsedCommit,
  forkContext: string
): Promise<AIAnalysisResult> {
  const taskId = await backgroundTask({
    agent: "explore",
    prompt: `
UPSTREAM CHANGE:
- Commit: ${commit.sha}
- Message: ${commit.subject}
- Files changed: ${commit.files.map(f => f.path).join(", ")}

FORK CONTEXT:
${forkContext}

EVALUATE:
1. Does this fix a bug our fork might have?
2. Does this add functionality we'd benefit from?
3. Does this conflict with our customizations?
4. What's the risk level of integrating this?

RESPOND IN JSON:
{
  "priority": "P0|P1|P2|P3|Skip",
  "reasoning": "2-3 sentences explaining why",
  "conflictLikelihood": "likely|possible|unlikely",
  "action": "sync_immediately|queue_for_batch|skip",
  "affectedAreas": ["area1", "area2"]
}
    `.trim(),
    run_in_background: false,  // Wait for result
  })
  
  // Parse AI response
  return parseAIResponse(taskId.result)
}
```

## Implementation Steps

### Phase 1: Foundation (2h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 1.1 | Create tool directory structure | `src/tools/sync-fork/*` | 10min |
| 1.2 | Define TypeScript interfaces | `types.ts` | 30min |
| 1.3 | Implement constants and risk hints | `constants.ts` | 15min |
| 1.4 | Implement state file management | `state.ts` | 30min |
| 1.5 | Create git-adapter with preflight | `git-adapter.ts` | 25min |
| 1.6 | Write tool skeleton and registration | `tools.ts`, `index.ts` | 10min |

**Deliverables**:
- Tool directory with all files
- Complete TypeScript type definitions
- State file read/write with atomic updates
- GitAdapter validates upstream, fetches, calculates merge-base

**Verification**:
```bash
bun run typecheck
# Tool should register without errors
```

### Phase 2: Discovery & Parsing (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Implement git log parsing | `git-adapter.ts` | 30min |
| 2.2 | Create conventional commit parser | `git-adapter.ts` | 25min |
| 2.3 | Add security keyword detection | `git-adapter.ts` | 15min |
| 2.4 | Filter commits by state (skip already reviewed) | `tools.ts` | 20min |

**Git Commands Used**:
```bash
git remote get-url upstream
git fetch upstream
git merge-base HEAD upstream/main
git log --reverse --pretty=format:"%H|%an|%ae|%ad|%s|%P" \
  --date=iso-strict {merge-base}..upstream/main
git show --name-status --pretty=format: {sha}
```

**Deliverables**:
- Parse git log into ParsedCommit[]
- Filter out commits already in state file
- Conventional commit type detection

### Phase 3: AI Analysis Integration (2h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Create analysis orchestrator | `analysis.ts` | 40min |
| 3.2 | Build fork context for AI | `analysis.ts` | 30min |
| 3.3 | Parse AI responses | `analysis.ts` | 25min |
| 3.4 | Handle analysis failures gracefully | `analysis.ts` | 25min |

**AI Analysis Prompt Template**:
```
UPSTREAM CHANGE:
- Commit: {sha}
- Message: {message}
- Files changed: {files}
- Diff: {diff}

FORK CONTEXT:
- Our version of changed files: {fork_files}
- Our customizations in this area: {custom_diffs}

EVALUATE:
1. Does this fix a bug we might have?
2. Does this add functionality we'd benefit from?
3. Does this conflict with our customizations?
4. What's the risk level of integrating this?

OUTPUT (JSON):
- priority: P0/P1/P2/P3/Skip
- reasoning: [2-3 sentences]
- conflictLikelihood: likely/possible/unlikely
- action: sync_immediately/queue_for_batch/skip
```

**Deliverables**:
- Parallel AI analysis via background_task
- Fork context generation (our versions of changed files)
- Robust JSON parsing with fallbacks

### Phase 4: Recommendations & Report (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Group commits by PR/scope | `report.ts` | 30min |
| 4.2 | Generate SyncRecommendation objects | `report.ts` | 25min |
| 4.3 | Create markdown report format | `report.ts` | 20min |
| 4.4 | Generate Linear-ready issue descriptions | `report.ts` | 25min |

**Recommendation Output Example**:
```json
{
  "groupId": "security-auth-fix",
  "suggestedIssueTitle": "Sync: Security fix for auth token validation",
  "suggestedIssueDescription": "## Summary\n\nSync security fix from upstream...",
  "commits": [{ "sha": "abc123", ... }],
  "priority": "P0",
  "reasoning": "This patches a token bypass vulnerability...",
  "suggestedLabels": ["sync-upstream", "P0", "security"],
  "cherryPickCommand": "git cherry-pick -x abc123",
  "riskSummary": {
    "level": "HIGH",
    "conflictLikelihood": "unlikely",
    "affectedAreas": ["src/auth/"]
  }
}
```

### Phase 5: Execution Phase (2h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 5.1 | Implement cherry-pick execution | `execution.ts` | 30min |
| 5.2 | Implement branch creation | `execution.ts` | 15min |
| 5.3 | Implement push and PR creation | `execution.ts` | 30min |
| 5.4 | Integrate Linear issue creation | `execution.ts` | 25min |
| 5.5 | Update state file after execution | `execution.ts` | 20min |

**Execution Flow**:
```bash
# 1. Create integration branch
git checkout -b sync/upstream-2025-12-28

# 2. Cherry-pick approved commits
git cherry-pick -x abc123 def456 ghi789

# 3. Push to origin
git push -u origin sync/upstream-2025-12-28

# 4. Create PR
gh pr create --title "Sync: Upstream changes (3 commits)" \
  --body "$(cat <<'EOF'
## Summary
- 1 security fix (P0)
- 2 bug fixes (P1)

## Commits
- abc123: fix(auth): patch token validation
- def456: fix(lsp): resolve race condition
- ghi789: fix(hooks): memory leak in context monitor
EOF
)"
```

### Phase 6: Edge Cases & Polish (1h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 6.1 | Handle missing upstream remote | `git-adapter.ts` | 10min |
| 6.2 | Handle shallow clone warning | `git-adapter.ts` | 10min |
| 6.3 | Implement --reset-state flag | `state.ts` | 10min |
| 6.4 | Implement --dry-run flag | `tools.ts` | 10min |
| 6.5 | Update slash command file | `sync-fork.md` | 10min |
| 6.6 | Integration testing | - | 10min |

**Edge Cases Handled**:
| Edge Case | Detection | Mitigation |
|-----------|-----------|------------|
| No upstream remote | `git remote get-url upstream` fails | Prompt: `git remote add upstream <URL>` |
| Shallow clone | `git rev-parse --is-shallow-repository` | Warn: "Full history recommended" |
| 100+ commits behind | Commit count > limit | Suggest --limit flag |
| Fork is up-to-date | Zero new commits | Report "Fork is up to date" |
| AI analysis timeout | background_task timeout | Fall back to type-based priority |
| Corrupted state file | JSON.parse fails | Start fresh with warning |

## Dependencies

### Internal (This Repo)

| Dependency | Location | Usage |
|------------|----------|-------|
| `executeCommand` | `src/shared/command-executor.ts` | Git CLI execution |
| `log` | `src/shared/logger.ts` | Debug output |
| `createIssue` | `src/tools/linear/api.ts` | Linear issue creation |
| `atomicWrite` pattern | `src/features/context-learning/file-writer.ts` | State file writes |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| Git CLI | Required | Must be installed |
| gh CLI | Required | For PR creation |
| None (npm) | - | No external npm dependencies |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| AI misjudges conflict | Medium | Medium | Show AI reasoning, human reviews PR |
| State file corruption | Low | High | Atomic writes, --reset-state flag |
| Cherry-pick failures | Medium | Low | Graceful abort, clear instructions |
| AI analysis timeout | Low | Medium | Fallback to type-based priority |
| Large commit count | Medium | Medium | Pagination via --limit flag |

## Testing Strategy

### Manual Testing (Dogfooding)

1. **Setup**:
   ```bash
   git remote add upstream https://github.com/code-yeongyu/oh-my-opencode.git
   ```

2. **Test Scenarios**:
   - First run (no state file)
   - Second run (state file exists, new commits only)
   - --filter security
   - --dry-run
   - --reset-state
   - --scaffold

3. **Edge Case Testing**:
   - No upstream remote
   - Fork is up-to-date
   - 50+ commits behind
   - Non-conventional commit messages

## Success Metrics

| Metric | Target |
|--------|--------|
| Recurring workflow works | Running after previous run shows only NEW commits |
| AI provides reasoning | Every recommendation includes "why" explanation |
| Zero manual git | User doesn't type git commands—tool handles everything |
| Human final gate | User reviews PR, not individual commits |
| State persistence | Second run correctly filters already-reviewed commits |
| Linear integration | P0/P1 recommendations create Linear issues |

## Time Summary

| Phase | Estimate | Notes |
|-------|----------|-------|
| Phase 1: Foundation | 2h | Types, state, git-adapter |
| Phase 2: Discovery & Parsing | 1.5h | Git log parsing, commit filtering |
| Phase 3: AI Analysis | 2h | Agent orchestration, context building |
| Phase 4: Recommendations | 1.5h | Grouping, report generation |
| Phase 5: Execution | 2h | Cherry-pick, PR, Linear integration |
| Phase 6: Edge Cases | 1h | Error handling, polish |
| **Total** | **~10h** | |

## Next Steps

After plan approval:
1. Run `/tasks` to create detailed task breakdown
2. Run `/implement` to start Phase 1
3. Dogfood on oh-my-opencode upstream sync

---

## Appendix A: Git Commands Reference

```bash
# Check upstream remote
git remote get-url upstream

# Add upstream if missing
git remote add upstream https://github.com/code-yeongyu/oh-my-opencode.git

# Fetch upstream
git fetch upstream

# Find merge base
git merge-base HEAD upstream/main

# List upstream-only commits (new commits since merge-base)
git log --reverse --pretty=format:"%H|%an|%ae|%ad|%s|%P" \
  --date=iso-strict $(git merge-base HEAD upstream/main)..upstream/main

# Get file changes per commit
git show --name-status --pretty=format: <sha>

# Get fork-modified files (for conflict detection)
git diff --name-only $(git merge-base HEAD upstream/main)..HEAD

# Check shallow clone
git rev-parse --is-shallow-repository

# Cherry-pick with reference
git cherry-pick -x <sha>

# Create PR
gh pr create --title "..." --body "..."
```

## Appendix B: State File Example

```json
{
  "version": 1,
  "upstream": {
    "remote": "upstream",
    "branch": "main",
    "lastFetchedAt": "2025-12-28T10:00:00Z"
  },
  "lastReviewedCommit": "abc1234def5678",
  "lastReviewedAt": "2025-12-28T10:00:00Z",
  "commits": {
    "abc1234": {
      "status": "synced",
      "pr": "#123",
      "reviewedAt": "2025-12-28T10:00:00Z"
    },
    "def5678": {
      "status": "skipped",
      "reason": "Not relevant - dark mode feature we already have",
      "reviewedAt": "2025-12-28T10:00:00Z"
    },
    "ghi9012": {
      "status": "reviewed",
      "recommendation": "P1",
      "reviewedAt": "2025-12-28T10:00:00Z"
    }
  }
}
```

## Appendix C: Report Output Example

```markdown
# SYNC FORK ANALYSIS REPORT

## Summary
- **Upstream**: code-yeongyu/oh-my-opencode (main)
- **Fork**: your-username/oh-my-opencode (main)
- **New Commits**: 12 (47 total, 35 already reviewed)
- **Last Reviewed**: 2025-12-27 (1 day ago)

## P0 - CRITICAL (Sync Immediately)

### Security Fix: Auth Token Validation
- **Commit**: abc1234
- **Message**: fix(auth): patch token bypass vulnerability
- **AI Reasoning**: "This patches a token bypass vulnerability (CVE-2024-XXXX). 
  Our fork uses the same auth module and is vulnerable."
- **Conflict Risk**: Unlikely
- **Cherry-pick**: `git cherry-pick -x abc1234`

## P1 - HIGH (Sync Soon)

### Bug Fix: LSP Race Condition
- **Commits**: def5678, ghi9012
- **Messages**: 
  - fix(lsp): resolve race condition in symbol resolution
  - fix(lsp): add mutex for concurrent requests
- **AI Reasoning**: "We've seen intermittent LSP failures. These commits address 
  the root cause with proper synchronization."
- **Conflict Risk**: Possible (src/tools/lsp/ modified in fork)
- **Cherry-pick**: `git cherry-pick -x def5678 ghi9012`

## SKIP

### Feature: Dark Mode Toggle
- **Commit**: jkl3456
- **AI Reasoning**: "We have our own custom dark mode implementation. 
  Would conflict with our theming system."

---

## Next Steps

1. **Approve P0/P1 recommendations** to create sync branch and PR
2. **Create Linear issues** for tracking (auto-created for P0/P1)
3. **Review the PR** - human final gate
```
