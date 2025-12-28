# Sync Fork Command - Task Breakdown

**Linear Issue**: [LIF-74](https://linear.app/lifelogger/issue/LIF-74/sync-fork-command-recurring-workflow-for-upstream-synchronization)
**Created**: 2025-12-28
**Updated**: 2025-12-28 (aligned with AI-agent-driven plan)
**Total Estimate**: ~10h

## Vision

```
/sync-fork → AI Analysis → Recommendations → Cherry-pick → PR → Linear Issues
```

Each recommendation = one spec unit = one Linear issue = one development cycle.

---

## Phase 1: Foundation (2h)

**Goal**: Establish tool skeleton, types, state management, git-adapter.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T1.1 | Create `src/tools/sync-fork/` directory + empty files | Not Started | 10m | index.ts, types.ts, constants.ts, tools.ts, state.ts, git-adapter.ts, analysis.ts, report.ts, execution.ts |
| T1.2 | Define TypeScript interfaces in `types.ts` | Not Started | 30m | SyncForkState, ParsedCommit, AIAnalysisResult, SyncRecommendation, SyncForkArgs/Result |
| T1.3 | Implement constants and risk hints in `constants.ts` | Not Started | 15m | FILE_RISK_HINTS, SECURITY_KEYWORDS, defaults |
| T1.4 | Implement state file management in `state.ts` | Not Started | 30m | atomicWriteState, readState, atomic writes with temp file |
| T1.5 | Create git-adapter with preflight in `git-adapter.ts` | Not Started | 25m | validateUpstream, fetch, getMergeBase, worktree-safe repoRoot |
| T1.6 | Write tool skeleton and registration in `tools.ts`, `index.ts` | Not Started | 10m | Tool args schema, export, register in src/tools/index.ts |

**Deliverables**:
- Tool directory with all files
- Complete TypeScript type definitions
- State file read/write with atomic updates
- GitAdapter validates upstream, fetches, calculates merge-base

**Verification**:
```bash
bun run typecheck
```

---

## Phase 2: Discovery & Parsing (1.5h)

**Goal**: Collect upstream-only commits + metadata robustly.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T2.1 | Implement git log parsing in `git-adapter.ts` | Not Started | 30m | Use delimiter-safe format (%x1f/%x1e), parse into ParsedCommit[] |
| T2.2 | Create conventional commit parser in `git-adapter.ts` | Not Started | 25m | Regex for type(scope)!:, BREAKING CHANGE footers, fallback to "other" |
| T2.3 | Add security keyword detection in `git-adapter.ts` | Not Started | 15m | CVE, vulnerability, exploit, auth bypass, injection, etc. |
| T2.4 | Filter commits by state (skip already reviewed) in `tools.ts` | Not Started | 20m | Check state.commits[sha].status, only return pending/new |

**Deliverables**:
- Parse git log into ParsedCommit[]
- Filter out commits already in state file
- Conventional commit type detection
- Security commits auto-flagged

---

## Phase 3: AI Analysis Integration (2h)

**Goal**: Orchestrate AI agents for commit analysis with fork context.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T3.1 | Create analysis orchestrator in `analysis.ts` | Not Started | 40m | analyzeCommitWithAI function, background_task(agent="explore") |
| T3.2 | Build fork context for AI in `analysis.ts` | Not Started | 30m | Read our versions of changed files, get fork customizations |
| T3.3 | Parse AI responses in `analysis.ts` | Not Started | 25m | JSON parsing with fallbacks for malformed responses |
| T3.4 | Handle analysis failures gracefully in `analysis.ts` | Not Started | 25m | Timeout handling, fallback to type-based priority |

**AI Analysis Prompt Template**:
```
UPSTREAM CHANGE:
- Commit: {sha}
- Message: {message}
- Files changed: {files}
- Diff: {diff}

FORK CONTEXT:
- Our version of changed files: {fork_files}

EVALUATE:
1. Does this fix a bug we might have?
2. Does this add functionality we'd benefit from?
3. Does this conflict with our customizations?
4. What's the risk level of integrating this?

OUTPUT (JSON):
{
  "priority": "P0|P1|P2|P3|Skip",
  "reasoning": "2-3 sentences",
  "conflictLikelihood": "likely|possible|unlikely",
  "action": "sync_immediately|queue_for_batch|skip"
}
```

**Deliverables**:
- Parallel AI analysis via background_task
- Fork context generation
- Robust JSON parsing with fallbacks

---

## Phase 4: Recommendations & Report (1.5h)

**Goal**: Generate SyncRecommendation objects with Linear-ready fields.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T4.1 | Group commits by PR/scope in `report.ts` | Not Started | 30m | Detect PR refs (#123), scope-based grouping |
| T4.2 | Generate SyncRecommendation objects in `report.ts` | Not Started | 25m | suggestedIssueTitle, suggestedIssueDescription, cherryPickCommand |
| T4.3 | Create markdown report format in `report.ts` | Not Started | 20m | Grouped by priority (P0 → P3 → Skip), AI reasoning included |
| T4.4 | Generate Linear-ready issue descriptions in `report.ts` | Not Started | 25m | Markdown with context, commits, risk summary, suggested labels |

**Deliverables**:
- Recommendations grouped by priority
- Linear-ready issue titles and descriptions
- Human-readable markdown report

---

## Phase 5: Execution Phase (2h)

**Goal**: Cherry-pick, push, PR creation, Linear integration.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T5.1 | Implement cherry-pick execution in `execution.ts` | Not Started | 30m | git cherry-pick -x {sha}, handle conflicts gracefully |
| T5.2 | Implement branch creation in `execution.ts` | Not Started | 15m | git checkout -b sync/upstream-{date} |
| T5.3 | Implement push and PR creation in `execution.ts` | Not Started | 30m | git push -u origin, gh pr create with summary |
| T5.4 | Integrate Linear issue creation in `execution.ts` | Not Started | 25m | Call linear_create_issue for P0/P1 recommendations |
| T5.5 | Update state file after execution in `execution.ts` | Not Started | 20m | Mark commits as synced, update lastReviewedCommit |

**Deliverables**:
- Cherry-pick execution with conflict handling
- PR creation with comprehensive summary
- Linear issue creation for P0/P1
- State file updated after sync

---

## Phase 6: Edge Cases & Polish (1h)

**Goal**: Handle edge cases, add command file, verification.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T6.1 | Handle missing upstream remote | Not Started | 10m | Clear error with `git remote add upstream <URL>` suggestion |
| T6.2 | Handle shallow clone warning | Not Started | 10m | Warn + suggest `git fetch --unshallow` |
| T6.3 | Implement --reset-state flag | Not Started | 10m | Delete state file and start fresh |
| T6.4 | Implement --dry-run flag | Not Started | 10m | Analyze only, don't execute anything |
| T6.5 | Update slash command file | Not Started | 10m | .opencode/command/sync-fork.md with examples |
| T6.6 | Integration testing (dogfood) | Not Started | 10m | Run against real upstream |

**Deliverables**:
- Edge cases handled cleanly
- All flags implemented
- Command discoverable via slashcommand loader

---

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Foundation | 6 | 2h | Not Started |
| Phase 2: Discovery & Parsing | 4 | 1.5h | Not Started |
| Phase 3: AI Analysis Integration | 4 | 2h | Not Started |
| Phase 4: Recommendations & Report | 4 | 1.5h | Not Started |
| Phase 5: Execution Phase | 5 | 2h | Not Started |
| Phase 6: Edge Cases & Polish | 6 | 1h | Not Started |
| **Total** | **29** | **~10h** | - |

---

## Recommended Execution Order

1. **T1.1–T1.6** (tool wired + state + git-adapter)
2. **T2.1–T2.4** (collection + parsing + filters)
3. **T3.1–T3.4** (AI analysis integration)
4. **T4.1–T4.4** (recommendations + report)
5. **T5.1–T5.5** (execution phase)
6. **T6.1–T6.6** (edge cases + polish)

---

## Key Design Decisions (from Spec)

- **DD-1**: AI agents evaluate commits (not scoring formulas)
- **DD-2**: State tracking is P0 (required, not optional)
- **DD-3**: Humans review at PR stage (not individual commits)
- **DD-4**: No offline mode (git fetch requires network anyway)

## Linear Integration

- Each P0/P1 recommendation auto-creates a Linear issue
- Labels: `sync-upstream`, priority label (`P0`, `P1`, `P2`)
- Links to upstream commit(s) and cherry-pick command
