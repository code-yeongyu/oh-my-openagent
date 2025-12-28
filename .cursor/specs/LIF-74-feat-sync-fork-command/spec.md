# Sync Fork Command: AI-Driven Upstream Synchronization

**Linear Issue**: [LIF-74](https://linear.app/lifelogger/issue/LIF-74/sync-fork-command-recurring-workflow-for-upstream-synchronization)
**Created**: 2025-12-28
**Status**: In Review (APPROVE_WITH_CHANGES)
**Updated**: 2025-12-28

---

## Overview

A `/sync-fork` command that uses AI agents to intelligently analyze upstream changes, determine what's valuable for your fork, and automate the sync process from discovery to PR creation. The AI handles analysis and recommendations; humans review the final PR.

## Problem Statement

### Current State

Fork maintainers manually:
1. Run `git log` commands to find upstream changes
2. Read each commit to understand its relevance
3. Mentally track what they've already reviewed
4. Decide which commits to cherry-pick based on gut feeling
5. Execute cherry-picks and create PRs

### Issues

1. **No memory**: Each sync session starts from scratch—no tracking of previously reviewed commits
2. **Manual analysis**: Humans read diffs instead of AI agents that understand the fork's context
3. **No reasoning**: Decisions are made without documented rationale
4. **Cherry-pick friction**: Manual command execution is error-prone
5. **Recurring overhead**: Without automation, forks drift further from upstream

---

## User Stories

### US-1: As a fork maintainer

I want to run `/sync-fork` and get AI-analyzed recommendations with reasoning,
So that I understand WHY each upstream change is or isn't valuable for my fork.

**Acceptance Criteria:**
- [ ] AI agent reads upstream diffs AND my fork's related code
- [ ] Each recommendation includes reasoning ("why sync this?")
- [ ] Recommendations grouped by priority (P0-P3) with explanations
- [ ] AI considers my fork's customizations when evaluating conflicts

### US-2: As a recurring user

I want `/sync-fork` to remember what I've already reviewed,
So that I only see NEW commits each time I run the command.

**Acceptance Criteria:**
- [ ] State file tracks: last reviewed commit, reviewed commits, skipped commits, synced commits
- [ ] Running `/sync-fork` after previous run shows only new upstream commits
- [ ] State persists across sessions (file-based)
- [ ] Can reset state if needed (`--reset-state`)

### US-3: As a busy maintainer

I want AI to handle everything from discovery to PR creation,
So that I only need to review the final PR.

**Acceptance Criteria:**
- [ ] Zero manual git commands required from user
- [ ] AI executes cherry-picks and handles conflicts where possible
- [ ] AI creates PR with summary of synced changes
- [ ] Human reviews PR as the final gate

### US-4: As a security-conscious maintainer

I want to filter by commit type (security, fix, perf),
So that I can prioritize critical updates.

**Acceptance Criteria:**
- [ ] Support combined filters: `--filter fix,security`
- [ ] Semantic detection of commit types from conventional commits + keywords
- [ ] Security commits auto-flagged as P0

---

## Requirements

### Functional Requirements

#### FR-1: State Tracking (P0 - Required)

Track sync state in `.opencode/state/sync-fork.json`:

```json
{
  "version": 1,
  "upstream": {
    "remote": "upstream",
    "branch": "main",
    "lastFetchedAt": "2025-12-28T10:00:00Z"
  },
  "lastReviewedCommit": "abc1234",
  "lastReviewedAt": "2025-12-28T10:00:00Z",
  "commits": {
    "abc1234": { "status": "synced", "pr": "#123", "reviewedAt": "..." },
    "def5678": { "status": "skipped", "reason": "Not relevant", "reviewedAt": "..." },
    "ghi9012": { "status": "reviewed", "recommendation": "P1", "reviewedAt": "..." }
  }
}
```

**Commit statuses:**
- `synced` - Cherry-picked and merged
- `skipped` - Explicitly skipped by user
- `reviewed` - Analyzed but not yet synced
- `pending` - Discovered but not yet analyzed

#### FR-2: AI Analysis Phase

For each commit group, spawn analysis agent that:
1. Reads the upstream diff
2. Reads our fork's related code (same files, nearby modules)
3. Evaluates: "Is this valuable for OUR fork?"
4. Considers conflicts with our customizations
5. Provides reasoning (not just P0-P3, but WHY)

**Analysis prompt structure:**
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

OUTPUT:
- Priority: P0/P1/P2/P3/Skip
- Reasoning: [2-3 sentences]
- Conflict likelihood: Low/Medium/High
- Recommended action: Sync immediately / Queue for batch / Skip
```

#### FR-3: Prioritized Recommendations

Output format:
```
P0-CRITICAL (Sync Immediately):
- abc1234: "Security fix in auth - patches CVE-2024-XXXX"
  → AI reasoning: "This patches a token bypass vulnerability. Our fork uses the same auth module."

P1-HIGH (Sync Soon):
- def5678: "Bug fix in LSP client - resolves race condition"
  → AI reasoning: "We've seen intermittent LSP failures. This fix addresses the root cause."

SKIP:
- ghi9012: "Feature X - adds dark mode"
  → AI reasoning: "We have our own custom dark mode implementation. Would conflict."
```

#### FR-4: Execution Phase (AI-driven)

When user approves recommendations:
1. Create integration branch: `sync/upstream-YYYY-MM-DD`
2. Cherry-pick approved commits (in dependency order)
3. If conflict: Attempt auto-resolution, flag if manual needed
4. Create PR with summary
5. Update state file with synced commits

#### FR-5: Command Interface

```
/sync-fork [options]

OPTIONS:
  --filter TYPE[,TYPE]   Filter: all|fix|perf|security|feat (default: all)
  --since DATE           Only commits since date (ISO-8601 or relative)
  --limit N              Max commits to analyze (default: 50)
  --output FORMAT        Output: json|markdown (default: markdown)
  --scaffold             Create branch + cherry-pick commands (no execution)
  --reset-state          Clear state file and start fresh
  --dry-run              Analyze only, don't execute anything
```

### Non-Functional Requirements

#### NFR-1: Performance
- Discovery phase: < 30 seconds for 100 commits
- AI analysis: Parallel agents, total < 2 minutes for 50 commits

#### NFR-2: Reliability
- State file atomically updated (write to temp, rename)
- Graceful handling of network failures
- Clear error messages with recovery steps

---

## Architecture

### Agent Workflow

```
┌─────────────────────────────────────────────────────────────────┐
│                    /sync-fork Command                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 1: Discovery (Git Operations)                            │
│  ─────────────────────────────────────────────────────────────  │
│  1. Load state file → Get last reviewed commit                  │
│  2. git fetch upstream                                          │
│  3. git log --since={lastReviewed}..upstream/main              │
│  4. Group commits by PR/scope                                   │
│  Output: List of commit groups to analyze                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 2: AI Analysis (Parallel Agents)                         │
│  ─────────────────────────────────────────────────────────────  │
│  For each commit group:                                         │
│    background_task(agent="explore", prompt="""                  │
│      Analyze upstream change: {diff}                            │
│      Compare with our fork: {fork_context}                      │
│      Evaluate value + conflict risk                             │
│      Provide priority + reasoning                               │
│    """)                                                         │
│                                                                 │
│  Collect results with background_output                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 3: Recommendations Report                                │
│  ─────────────────────────────────────────────────────────────  │
│  - Group by priority (P0 → P3 → Skip)                          │
│  - Include AI reasoning for each                                │
│  - Show conflict warnings                                       │
│  - Present to user for approval                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                   User approves ▼
┌─────────────────────────────────────────────────────────────────┐
│  Phase 4: Execution (AI-driven)                                 │
│  ─────────────────────────────────────────────────────────────  │
│  1. git checkout -b sync/upstream-{date}                        │
│  2. git cherry-pick -x {commits}                                │
│  3. Handle conflicts (AI attempts resolution)                   │
│  4. git push origin {branch}                                    │
│  5. Create PR via gh pr create                                  │
│  6. Update state file                                           │
│                                                                 │
│  Human reviews PR ← FINAL GATE                                  │
└─────────────────────────────────────────────────────────────────┘
```

### File Risk Classification

Quick reference for AI agents to assess change risk:

| Risk Level | Paths | Rationale |
|------------|-------|-----------|
| HIGH | `src/index.ts`, `src/config/schema.ts` | Core plugin wiring |
| HIGH | `src/hooks/governance-*/**`, `src/auth/**` | Security-critical |
| MEDIUM | `src/agents/**`, `src/tools/**`, `src/features/**` | Individual components |
| LOW | `docs/**`, `tests/**`, `*.md` | Documentation, tests |

AI uses this as context, NOT as a rigid formula.

### Semantic Type Detection

AI-assisted detection with these hints:

| Type | Signals |
|------|---------|
| SECURITY | CVE, vulnerability, exploit, auth bypass, injection, hardening |
| BUGFIX | fix:, bug, crash, error, failing, regression |
| PERFORMANCE | perf:, optimize, slow, latency, memory, cache |
| FEATURE | feat:, add, new, implement |

AI has final say—these are hints, not rules.

---

## Scope

### In Scope

- State file tracking (P0)
- AI-driven analysis with reasoning
- Parallel agent execution
- Cherry-pick automation
- PR creation
- Basic conflict detection
- Filter by commit type

### Out of Scope

- Automatic conflict resolution (flag for manual)
- Multi-remote sync (single upstream only)
- GitHub/GitLab API for upstream PR metadata
- Submodule synchronization
- Automatic merge (cherry-pick only)

---

## Assumptions

1. User has git CLI and gh CLI installed
2. Upstream remote is configured (`git remote add upstream <URL>`)
3. Fork maintainer has push access to origin
4. Upstream follows conventional commits (mostly)
5. Cherry-pick is preferred sync method

---

## Dependencies

1. **Git CLI** - Core operations
2. **gh CLI** - PR creation
3. **OpenCode agents** - explore agent for analysis
4. **State file** - `.opencode/state/sync-fork.json`

---

## Success Criteria

1. **Recurring workflow works**: Running `/sync-fork` after previous run only shows NEW commits
2. **AI provides reasoning**: Every recommendation includes "why sync this?"
3. **Zero manual git**: User doesn't type git commands—AI handles discovery to PR
4. **Human final gate**: User reviews the PR, not individual commits

---

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| AI misjudges conflict | Medium | Medium | Always flag HIGH risk files for human review |
| State file corruption | Low | High | Atomic writes, backup before modify |
| Cherry-pick failures | Medium | Low | Graceful abort, clear instructions to user |
| Agent timeout on large repos | Low | Medium | Limit commits per run, pagination |

---

## Design Decisions

### DD-1: AI Agents Over Formulas

**Decision**: Use AI agents for scoring instead of mathematical formulas.

**Context**: Original spec had complex scoring like `PriorityScore = 0.65*ValueScore + 0.20*(100*(1-ConflictProb))...`

**Rationale**: AI agents can:
- Read actual code context
- Understand semantic meaning
- Provide reasoning for decisions
- Adapt to fork-specific patterns

Formulas are rigid; AI judgment is contextual.

### DD-2: State Tracking is P0

**Decision**: State file is required, not optional.

**Context**: Original spec had this as P2 optional.

**Rationale**: Without state, recurring workflow is impossible. The command would re-analyze the same commits every run, defeating the purpose.

### DD-3: Human Reviews at PR Stage

**Decision**: Human reviews the final PR, not individual commit selections.

**Context**: Could require human approval at each phase.

**Rationale**: 
- Reduces interruptions
- AI handles tedious discovery/analysis
- Human expertise applied where it matters most (code review)
- Faster end-to-end workflow

### DD-4: Removed Offline Requirement

**Decision**: No special offline mode.

**Context**: Original spec emphasized "offline-first" design.

**Rationale**: `git fetch` requires network anyway. The command is inherently online. Simplifies implementation without losing functionality.

---

## Resolved Decisions

1. **Linear Integration**: ✅ YES - Approved sync recommendations auto-create Linear issues.
   - Each P0/P1 recommendation becomes a Linear issue
   - Issue links to upstream commit(s) and cherry-pick command
   - Enables tracking via existing workflow: `/specify` → `/plan` → `/implement`
   - Labels: `sync-upstream`, priority label (`P0`, `P1`, `P2`)

---

## Implementation Review Findings (2025-12-28)

**Review Status**: APPROVE_WITH_CHANGES
**Review File**: `.cursor/specs/LIF-74-feat-sync-fork-command/reviews/2025-12-28-implementation-review.md`

### Critical Issues (Must Fix)

#### C1: Tool Not Registered in Main Plugin

**Location**: `src/index.ts`
**Issue**: `createSyncForkTool` is exported from `src/tools/index.ts` but NOT instantiated and registered in the main plugin's tool object.

**Impact**: The tool will not be available to users. The `/sync-fork` command will fail because the underlying tool doesn't exist.

**Fix Required**:
```typescript
// In src/index.ts imports:
import { createSyncForkTool } from "./tools";

// In OhMyOpenCodePlugin function:
const syncFork = createSyncForkTool(ctx);

// In return object tool section:
tool: {
  // ... existing tools
  sync_fork: syncFork,
}
```

**Effort**: Quick (<1h)

---

### Major Issues (Should Fix)

#### M1: Filter Option Should Support Array (Spec Mismatch)

**Location**: `src/tools/sync-fork/types.ts:182`, `tools.ts:27`
**Issue**: Spec FR-5 says `--filter TYPE[,TYPE]` (array), but implementation uses single enum.

**Spec Requirement**:
```
--filter TYPE[,TYPE]   Filter: all|fix|perf|security|feat (default: all)
```

**Current Implementation**:
```typescript
filter?: "all" | "fix" | "perf" | "security" | "feat"  // Single value only
```

**Impact**: Users cannot filter by multiple types (e.g., `--filter fix,security`) as US-4 requires.

**Fix Required**: Change to array type and update filtering logic.

**Effort**: Short (1-4h)

---

#### M2: AI Analysis Not Actually Used

**Location**: `src/tools/sync-fork/tools.ts:147`, `analysis.ts`
**Issue**: `prepareAnalysisPackets()` is exported but never called. The tool uses `suggestPriority()` (heuristic) instead of actual AI analysis.

**Impact**: The spec's core value proposition (AI-driven analysis with reasoning per FR-2) is not implemented. Users get heuristic-based priorities, not AI reasoning.

**Current State**: This appears intentional for Phase 1 (foundation). The `prepareAnalysisPackets` and `parseAIResponse` functions are scaffolded for future AI integration.

**Decision Needed**: 
1. Document as Phase 2 feature, OR
2. Implement basic AI analysis using background_task

**Effort**: Medium (1-2d) for full AI integration, Quick (<1h) for documentation

---

#### M3: Linear Integration Not Implemented

**Location**: `src/tools/sync-fork/execution.ts`
**Issue**: Spec "Resolved Decisions" section requires P0/P1 recommendations to auto-create Linear issues, but this is not implemented.

**Spec Requirement**:
> Each P0/P1 recommendation becomes a Linear issue

**Impact**: Users must manually create Linear issues for sync recommendations.

**Fix Required**: Add Linear integration in `executeSync()` to call `linear_create_issue` for P0/P1 recommendations.

**Effort**: Short (1-4h)

---

### Minor Issues (Nice to Fix)

#### m1: Inconsistent Log Prefix

**Issue**: Some logs use `[sync-fork]`, others use `[sync_fork]`.
**Fix**: Standardize to `[sync-fork]` (kebab-case matches directory name).
**Effort**: Quick (<1h)

#### m2: Shell Escape Function Could Miss Edge Cases

**Location**: `src/tools/sync-fork/execution.ts:205-211`
**Issue**: `escapeForShell()` handles common cases but may miss newlines in PR body.
**Recommendation**: Use heredoc for PR body instead of inline escaping.
**Effort**: Quick (<1h)

#### m3: Missing JSDoc on Public Functions

**Issue**: Public API functions lack JSDoc documentation.
**Effort**: Short (1-4h)

---

### Suggestions (Optional)

1. **S1**: Add validation for `since` date format (ISO-8601)
2. **S2**: Consider caching upstream fetch (skip if < 5 min old)
3. **S3**: Add progress indicator for large commit sets (50+)

---

## Related Issues

- [LIF-69](https://linear.app/lifelogger/issue/LIF-69): OmO Delegation Optimization
- [LIF-67](https://linear.app/lifelogger/issue/LIF-67): Workflow State Persistence
