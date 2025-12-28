# Sync Fork Command - Task Breakdown

**Linear Issue**: [LIF-74](https://linear.app/lifelogger/issue/LIF-74/sync-fork-command-recurring-workflow-for-upstream-synchronization)
**Created**: 2025-12-28
**Updated**: 2025-12-28 (Phase 7 added from implementation review)
**Total Estimate**: ~13h

## Vision

```
/sync-fork → AI Analysis → Recommendations → Cherry-pick → PR → Linear Issues
```

Each recommendation = one spec unit = one Linear issue = one development cycle.

---

## Phase 1: Foundation (2h) ✅

**Goal**: Establish tool skeleton, types, state management, git-adapter.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T1.1 | Create `src/tools/sync-fork/` directory + empty files | Complete | 10m | index.ts, types.ts, constants.ts, tools.ts, state.ts, git-adapter.ts, analysis.ts, report.ts, execution.ts |
| T1.2 | Define TypeScript interfaces in `types.ts` | Complete | 30m | SyncForkState, ParsedCommit, AIAnalysisResult, SyncRecommendation, SyncForkArgs/Result |
| T1.3 | Implement constants and risk hints in `constants.ts` | Complete | 15m | FILE_RISK_HINTS, SECURITY_KEYWORDS, defaults |
| T1.4 | Implement state file management in `state.ts` | Complete | 30m | atomicWriteState, readState, atomic writes with temp file |
| T1.5 | Create git-adapter with preflight in `git-adapter.ts` | Complete | 25m | validateUpstream, fetch, getMergeBase, worktree-safe repoRoot |
| T1.6 | Write tool skeleton and registration in `tools.ts`, `index.ts` | Complete | 10m | Tool args schema, export, register in src/tools/index.ts |

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

## Phase 2: Discovery & Parsing (1.5h) ✅

**Goal**: Collect upstream-only commits + metadata robustly.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T2.1 | Implement git log parsing in `git-adapter.ts` | Complete | 30m | Use delimiter-safe format (%x1f/%x1e), parse into ParsedCommit[] |
| T2.2 | Create conventional commit parser in `git-adapter.ts` | Complete | 25m | Regex for type(scope)!:, BREAKING CHANGE footers, fallback to "other" |
| T2.3 | Add security keyword detection in `git-adapter.ts` | Complete | 15m | CVE, vulnerability, exploit, auth bypass, injection, etc. |
| T2.4 | Filter commits by state (skip already reviewed) in `tools.ts` | Complete | 20m | Check state.commits[sha].status, only return pending/new |

**Deliverables**:
- Parse git log into ParsedCommit[]
- Filter out commits already in state file
- Conventional commit type detection
- Security commits auto-flagged

---

## Phase 3: AI Analysis Integration (2h) ✅

**Goal**: Orchestrate AI agents for commit analysis with fork context.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T3.1 | Create analysis orchestrator in `analysis.ts` | Complete | 40m | analyzeCommitWithAI function, background_task(agent="explore") |
| T3.2 | Build fork context for AI in `analysis.ts` | Complete | 30m | Read our versions of changed files, get fork customizations |
| T3.3 | Parse AI responses in `analysis.ts` | Complete | 25m | JSON parsing with fallbacks for malformed responses |
| T3.4 | Handle analysis failures gracefully in `analysis.ts` | Complete | 25m | Timeout handling, fallback to type-based priority |

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

## Phase 4: Recommendations & Report (1.5h) ✅

**Goal**: Generate SyncRecommendation objects with Linear-ready fields.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T4.1 | Group commits by PR/scope in `report.ts` | Complete | 30m | Detect PR refs (#123), scope-based grouping |
| T4.2 | Generate SyncRecommendation objects in `report.ts` | Complete | 25m | suggestedIssueTitle, suggestedIssueDescription, cherryPickCommand |
| T4.3 | Create markdown report format in `report.ts` | Complete | 20m | Grouped by priority (P0 → P3 → Skip), AI reasoning included |
| T4.4 | Generate Linear-ready issue descriptions in `report.ts` | Complete | 25m | Markdown with context, commits, risk summary, suggested labels |

**Deliverables**:
- Recommendations grouped by priority
- Linear-ready issue titles and descriptions
- Human-readable markdown report

---

## Phase 5: Execution Phase (2h) ✅

**Goal**: Cherry-pick, push, PR creation, Linear integration.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T5.1 | Implement cherry-pick execution in `execution.ts` | Complete | 30m | git cherry-pick -x {sha}, handle conflicts gracefully |
| T5.2 | Implement branch creation in `execution.ts` | Complete | 15m | git checkout -b sync/upstream-{date} |
| T5.3 | Implement push and PR creation in `execution.ts` | Complete | 30m | git push -u origin, gh pr create with summary |
| T5.4 | Integrate Linear issue creation in `execution.ts` | Complete | 25m | Call linear_create_issue for P0/P1 recommendations |
| T5.5 | Update state file after execution in `execution.ts` | Complete | 20m | Mark commits as synced, update lastReviewedCommit |

**Deliverables**:
- Cherry-pick execution with conflict handling
- PR creation with comprehensive summary
- Linear issue creation for P0/P1
- State file updated after sync

---

## Phase 6: Edge Cases & Polish (1h) ✅

**Goal**: Handle edge cases, add command file, verification.

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T6.1 | Handle missing upstream remote | Complete | 10m | Clear error with `git remote add upstream <URL>` suggestion |
| T6.2 | Handle shallow clone warning | Complete | 10m | Warn + suggest `git fetch --unshallow` |
| T6.3 | Implement --reset-state flag | Complete | 10m | Delete state file and start fresh |
| T6.4 | Implement --dry-run flag | Complete | 10m | Analyze only, don't execute anything |
| T6.5 | Update slash command file | Complete | 10m | .opencode/command/sync-fork.md with examples |
| T6.6 | Integration testing (dogfood) | Complete | 10m | Run against real upstream |

**Deliverables**:
- Edge cases handled cleanly
- All flags implemented
- Command discoverable via slashcommand loader

---

## Phase 7: Review Fixes (3h)

**Goal**: Address issues identified during implementation review. Priority: Critical → Major → Minor.

### Critical Issues (Must Fix)

| ID | Task | Status | Estimate | Files | Notes |
|----|------|--------|----------|-------|-------|
| T7.1 | Register tool in `src/index.ts` | Not Started | 30m | `src/index.ts`, `src/tools/index.ts` | Tool exported but NOT instantiated/registered. Import `createSyncForkTool`, instantiate with ctx, add to tool object as `sync_fork`. **Tool won't work without this.** |

### Major Issues (Should Fix)

| ID | Task | Status | Estimate | Files | Notes |
|----|------|--------|----------|-------|-------|
| T7.2 | Support array filter (`--filter fix,security`) | Not Started | 1.5h | `src/tools/sync-fork/types.ts`, `src/tools/sync-fork/tools.ts` | Spec says array, implementation uses single enum. Update type to `filter?: CommitType[] \| "all"`, accept comma-separated string, update filtering logic. |
| T7.3 | Document AI analysis as Phase 2 | Not Started | 30m | `src/tools/sync-fork/tools.ts`, `.opencode/command/sync-fork.md` | `prepareAnalysisPackets()` scaffolded but never called. Add comment at line ~147 explaining current heuristic-based approach, document AI integration as future Phase 2. |
| T7.4 | Implement Linear issue creation for P0/P1 | Not Started | 1h | `src/tools/sync-fork/execution.ts` | Per spec, P0/P1 recommendations should auto-create Linear issues. Add `linear_create_issue` calls in `executeSync()` for high-priority recommendations. |

### Minor Issues (Nice to Fix)

| ID | Task | Status | Estimate | Files | Notes |
|----|------|--------|----------|-------|-------|
| T7.5 | Standardize log prefix to `[sync-fork]` | Not Started | 15m | `src/tools/sync-fork/tools.ts`, `git-adapter.ts`, `execution.ts`, `state.ts` | Inconsistent `[sync-fork]` vs `[sync_fork]`. Use kebab-case to match directory name. |
| T7.6 | Use heredoc for PR body in shell | Not Started | 15m | `src/tools/sync-fork/execution.ts` | Shell escape at lines 205-211 could miss newlines. Use heredoc pattern for PR body. |
| T7.7 | Add JSDoc to public functions | Not Started | 30m | `src/tools/sync-fork/*.ts` | Missing JSDoc documentation on public API functions. Add documentation for maintainability. |

**Checkpoint**: 
- `bun run typecheck` passes
- Tool appears in OpenCode tool list
- `--filter fix,security` works with multiple types
- P0/P1 recommendations create Linear issues
- All log messages use `[sync-fork]` prefix

### Task Details

**T7.1: Register tool in src/index.ts**
1. Import `createSyncForkTool` from `"./tools/sync-fork"`
2. In plugin initialization, instantiate: `const syncFork = createSyncForkTool(ctx)`
3. Add to tools object: `sync_fork: syncFork`
4. Verify with `bun run typecheck`

**T7.2: Support array filter**
1. Update `types.ts:182`: Change `filter?: CommitType` to `filter?: CommitType[] | "all"`
2. Update `tools.ts:27`: Parse comma-separated string into array
3. Update filtering logic to check if commit type is in array
4. Test: `--filter fix,security` should filter to both types

**T7.4: Implement Linear issue creation**
1. In `executeSync()`, after generating recommendations
2. For each P0/P1 recommendation, call `linear_create_issue`
3. Use `suggestedIssueTitle` and `suggestedIssueDescription` from recommendation
4. Add labels: `sync-upstream`, priority label (`P0`, `P1`)
5. Include upstream commit link and cherry-pick command

---

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Foundation | 6 | 2h | Complete ✅ |
| Phase 2: Discovery & Parsing | 4 | 1.5h | Complete ✅ |
| Phase 3: AI Analysis Integration | 4 | 2h | Complete ✅ |
| Phase 4: Recommendations & Report | 4 | 1.5h | Complete ✅ |
| Phase 5: Execution Phase | 5 | 2h | Complete ✅ |
| Phase 6: Edge Cases & Polish | 6 | 1h | Complete ✅ |
| Phase 7: Review Fixes | 7 | 3h | Not Started |
| **Total** | **36** | **~13h** | - |

---

## Recommended Execution Order

### Completed Phases (1-6)
1. ~~**T1.1–T1.6** (tool wired + state + git-adapter)~~ ✅
2. ~~**T2.1–T2.4** (collection + parsing + filters)~~ ✅
3. ~~**T3.1–T3.4** (AI analysis integration)~~ ✅
4. ~~**T4.1–T4.4** (recommendations + report)~~ ✅
5. ~~**T5.1–T5.5** (execution phase)~~ ✅
6. ~~**T6.1–T6.6** (edge cases + polish)~~ ✅

### Phase 7: Review Fixes (Remaining Work)
7. **T7.1** first (CRITICAL: tool registration - nothing works without this)
8. **T7.2** then **T7.4** (major fixes, can be parallel)
9. **T7.3** (documentation update)
10. **T7.5**, **T7.6**, **T7.7** (minor polish, can be parallel)
11. Final verification: `bun run typecheck && bun run build`

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

---

## Phase 7 Verification Checklist

Before marking Phase 7 complete:

- [ ] **T7.1**: Tool registered in `src/index.ts` - verify with `bun run typecheck`
- [ ] **T7.1**: Tool appears in OpenCode tool list when running
- [ ] **T7.2**: `--filter fix,security` accepts multiple types
- [ ] **T7.2**: Filtering logic correctly handles array of types
- [ ] **T7.3**: Comment added explaining AI analysis is Phase 2
- [ ] **T7.3**: Command file updated with AI analysis note
- [ ] **T7.4**: P0 recommendations create Linear issues
- [ ] **T7.4**: P1 recommendations create Linear issues
- [ ] **T7.5**: All log messages use `[sync-fork]` prefix
- [ ] **T7.6**: PR body uses heredoc pattern
- [ ] **T7.7**: Public functions have JSDoc comments
- [ ] **Final**: `bun run build` succeeds without errors
