# LIF-111: Upstream Fork Sync - Task Breakdown

**Linear Issue**: [LIF-111](https://linear.app/lifelogger/issue/LIF-111/sync-fork-with-upstream-code-yeongyuoh-my-opencode-397-commits)
**Created**: 2026-01-02
**Last Updated**: 2026-01-06
**Total Estimate**: 62-74h (9-11 days)

> **Update (2026-01-06)**: Added 30 new tasks across 2 new phases (Phase 1.5, Phase 4.5) to address 106 new commits since spec creation, including critical OpenCode 1.1.1 permission system compatibility.

## Overview

Comprehensive task breakdown for synchronizing fork with upstream (code-yeongyu/oh-my-opencode).
- **397 commits behind** upstream/master
- **118 commits ahead** with unique customizations
- **~504 files** with differences

### User Story Mapping (Updated 2026-01-06)

| User Story | Primary Phases | Key Deliverables |
|------------|----------------|------------------|
| US-1: Access upstream features | Phase 3, 4, 4.5, 5 | Sisyphus agent, 5+ new hooks, /refactor command, background concurrency |
| US-2: Preserve customizations | Phase 0, 5, 6 | Linear tools, .cursor/memory, .cursor/specs |
| US-3: Apply bug fixes | Phase 1, 1.5, 4.5 | Recovery pipeline, TTL pruning, OpenCode 1.1.1 compat, GC crash fix |
| US-4: Clear documentation | Phase 7 | AGENTS.md, README, changelog |

### New User Stories (Added 2026-01-06)

| User Story | Primary Phases | Key Deliverables |
|------------|----------------|------------------|
| US-5: OpenCode 1.1.1 Compatibility | Phase 1.5 | Permission system compat layer, version detection |
| US-6: Improved Background Agent Management | Phase 4.5 | Model-based concurrency limits, recursive prevention |

---

## Phase 0: Preparation (2h)

**Goal**: Create safe environment for sync with backup and documentation

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T001 | Create backup branch `backup-before-sync-YYYYMMDD` | Not Started | 5min | - | **CRITICAL PATH** - Must complete first |
| T002 | Push backup branch to origin | Not Started | 5min | T001 | Ensures remote backup exists |
| T003 | Enable git rerere for conflict reuse | Not Started | 5min | - | `git config rerere.enabled true` |
| T004 | Add upstream remote if not exists | Not Started | 5min | - | `git remote add upstream https://github.com/code-yeongyu/oh-my-opencode.git` |
| T005 | Fetch upstream and analyze divergence | Not Started | 15min | T004 | Document commit counts, key changes |
| T006 | Document fork customizations checklist | Not Started | 30min | T005 | Create FORK_CUSTOMIZATIONS.md with all unique files |
| T007 | Verify Linear tools functional (baseline) | Not Started | 15min | - | Test all 7 Linear tools before sync |
| T008 | Verify spec folders preserved (baseline) | Not Started | 10min | - | Count 27 spec folders in .cursor/specs/ |
| T009 | Measure baseline context tokens | Not Started | 15min | - | Record startup token usage (~22k expected) |
| T010 | Create sync integration branch | Not Started | 5min | T001-T009 | `sync/lif-111-upstream-YYYYMMDD` |
| T011 | Create checkpoint tag `checkpoint-phase-0` | Not Started | 5min | T010 | For rollback capability |

**Checkpoint Gate 0**:
- [ ] Backup branch exists on origin
- [ ] Upstream remote configured and fetched
- [ ] FORK_CUSTOMIZATIONS.md created
- [ ] Baseline metrics recorded (tokens, Linear tools, spec folders)
- [ ] Sync branch created from backup

---

## Phase 1: Critical Bug Fixes (4h)

**Goal**: Cherry-pick critical upstream fixes to stabilize codebase before main merge

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T012 | Cherry-pick recovery pipeline early exit (d4787c4) | Not Started | 30min | T011 | **CRITICAL** - Prevents infinite loops |
| T013 | Run typecheck after T012 | Not Started | 5min | T012 | Verify no type errors introduced |
| T014 | Cherry-pick compaction sufficient check + charsPerToken fix (dc057e9) | Not Started | 45min | T013 | **CRITICAL** - Fixes compaction logic |
| T015 | Run typecheck after T014 | Not Started | 5min | T014 | Verify no type errors |
| T016 | Cherry-pick API path parameter fix (b64b3f9) | Not Started | 30min | T015 | sessionID → id parameter fix |
| T017 | Run typecheck after T016 | Not Started | 5min | T016 | Verify no type errors |
| T018 | Cherry-pick context duplication fix (f3db564) | Not Started | 45min | T017 | **HIGH VALUE** - 22k → 11k tokens |
| T019 | Run typecheck after T018 | Not Started | 5min | T018 | Verify no type errors |
| T020 | Cherry-pick TTL pruning for background agents (d0694e5) | Not Started | 45min | T019 | **CRITICAL** - Prevents memory leaks |
| T021 | Run typecheck after T020 | Not Started | 5min | T020 | Verify no type errors |
| T022 | Cherry-pick todo enforcer improvements (8b99133, f6b066e) | Not Started | 45min | T021 | 500ms grace period, event-order detection |
| T023 | Run full test suite | Not Started | 15min | T022 | `bun test` - all tests must pass |
| T024 | Run build verification | Not Started | 10min | T023 | `bun run build` - must succeed |
| T025 | Measure context tokens post-fixes | Not Started | 10min | T024 | Should be < 12k (from ~22k) |
| T026 | Create checkpoint tag `checkpoint-phase-1` | Not Started | 5min | T025 | For rollback capability |

**Checkpoint Gate 1**:
- [ ] `bun run typecheck` passes (0 errors)
- [ ] `bun test` passes (all tests)
- [ ] `bun run build` succeeds
- [ ] Context tokens ≤ 12k at startup
- [ ] All 6 cherry-picks applied cleanly

---

## Phase 1.5: OpenCode 1.1.1 Compatibility (6h) [NEW] - **MOSTLY COMPLETE**

**Goal**: Implement OpenCode v1.1.1 permission system compatibility layer - CRITICAL for functioning

**Status Update (2026-01-06)**: Merged from `origin/dev` commit `4e30f83`. Core implementation complete, only tests and verification remaining.

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T026.1 | Create src/shared/opencode-version.ts | ✅ Done | 1h | T026 | Merged from origin/dev (110 lines) |
| T026.2 | Create src/shared/opencode-version.test.ts | ⏳ Pending | 30min | T026.1 | Need to sync from upstream |
| T026.3 | Create src/shared/permission-compat.ts | ✅ Done | 1h | T026.1 | Merged from origin/dev (79 lines) |
| T026.4 | Create src/shared/permission-compat.test.ts | ⏳ Pending | 30min | T026.3 | Need to sync from upstream |
| T026.5 | Update src/shared/index.ts exports | ✅ Done | 10min | T026.3, T026.4 | Merged from origin/dev |
| T026.6 | Update all specialist agents with permission compat | ✅ Done | 1.5h | T026.5 | 20+ agents updated in merge |
| T026.7 | Update background-agent/manager.ts with compat | ✅ Done | 30min | T026.5 | Merged from origin/dev |
| T026.8 | Update src/index.ts with compat initialization | ✅ Done | 30min | T026.7 | Merged from origin/dev |
| T026.9 | Run typecheck after all changes | ⏳ Pending | 10min | T026.8 | Need to verify |
| T026.10 | Run test suite for permission compat | ⏳ Pending | 20min | T026.9 | Need to sync tests from upstream |
| T026.11 | Create checkpoint tag `checkpoint-phase-1.5` | ⏳ Pending | 5min | T026.10 | For rollback capability |

**Checkpoint Gate 1.5**:
- [x] `src/shared/opencode-version.ts` correctly detects OpenCode versions
- [x] `src/shared/permission-compat.ts` converts permissions to correct format
- [x] All agents use permission compat layer
- [ ] Tests pass for both OpenCode 1.0.x and 1.1.x formats (tests need sync)
- [ ] `bun run typecheck` passes (needs verification)

**Remaining Work**: ~1.5h (sync tests from upstream, verify typecheck)

---

## Phase 2: Dependencies & Schema (6h)

**Goal**: Merge package.json and config schema with backward compatibility

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T027 | Analyze upstream package.json changes | Not Started | 30min | T026 | Document new deps, version changes |
| T028 | Merge package.json (theirs deps, ours scripts) | Not Started | 45min | T027 | **CRITICAL** - Keep our version, scripts |
| T029 | Regenerate bun.lock | Not Started | 15min | T028 | `bun install` |
| T030 | Verify bun install succeeds | Not Started | 10min | T029 | No dependency conflicts |
| T031 | Analyze upstream schema.ts changes | Not Started | 30min | T030 | Document new schemas, enums |
| T032 | Add Sisyphus to BuiltinAgentNameSchema | Not Started | 10min | T031 | Add "Sisyphus" to enum |
| T033 | Add Sisyphus to OverridableAgentNameSchema | Not Started | 10min | T032 | Add "Sisyphus" to enum |
| T034 | Add Sisyphus to AgentOverridesSchema | Not Started | 10min | T033 | Add optional Sisyphus config |
| T035 | Add PrimaryOrchestratorSchema | Not Started | 15min | T034 | `z.enum(["OmO", "Sisyphus"])` |
| T036 | Add SisyphusAgentConfigSchema | Not Started | 15min | T035 | Parallel to OmoAgentConfigSchema |
| T037 | Add ExperimentalFeaturesSchema | Not Started | 30min | T036 | preemptive_compaction, threshold, dcp, auto_resume |
| T038 | Add new hook names to HookNameSchema | Not Started | 15min | T037 | 5 new hooks: preemptive-compaction, etc. |
| T039 | Update OhMyOpenCodeConfigSchema | Not Started | 30min | T038 | Add primary_orchestrator, sisyphus_agent, experimental |
| T040 | Add backward-compatible hook name handling | Not Started | 30min | T039 | Warn on unknown hooks, don't fail |
| T041 | Update src/config/index.ts exports | Not Started | 15min | T040 | Export new types |
| T042 | Regenerate JSON schema | Not Started | 15min | T041 | `bun run build:schema` |
| T043 | Test existing fork config parsing | Not Started | 30min | T042 | Verify backward compatibility |
| T044 | Test new upstream-style config parsing | Not Started | 30min | T043 | Verify new features work |
| T045 | Run typecheck | Not Started | 10min | T044 | Must pass |
| T046 | Create checkpoint tag `checkpoint-phase-2` | Not Started | 5min | T045 | For rollback capability |

**Checkpoint Gate 2**:
- [ ] `bun install` succeeds
- [ ] `bun run typecheck` passes
- [ ] `bun run build:schema` succeeds
- [ ] Existing fork configs parse successfully
- [ ] New upstream configs parse successfully
- [ ] All new schemas exported correctly

---

## Phase 3: Agent Integration (8h)

**Goal**: Add Sisyphus agent alongside OmO with coexistence support

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T047 | Create src/agents/sisyphus.ts | Not Started | 2h | T046 | **CRITICAL PATH** - Full agent implementation |
| T048 | Create src/agents/sisyphus-prompt-builder.ts | Not Started | 1h | T047 | Prompt construction utilities |
| T049 | Update src/agents/types.ts | Not Started | 15min | T048 | Add Sisyphus to BuiltinAgentName type |
| T050 | Update AGENT_ROLE_REGISTRY in index.ts | Not Started | 15min | T049 | Add Sisyphus as "team-lead" |
| T051 | Update AGENT_GOVERNANCE_LEVELS in utils.ts | Not Started | 15min | T050 | Add Sisyphus governance level |
| T052 | Export Sisyphus from src/agents/index.ts | Not Started | 15min | T051 | Add to builtinAgents |
| T053 | Add primary_orchestrator config handling | Not Started | 1h | T052 | Logic to choose OmO vs Sisyphus |
| T054 | Add agent name normalization | Not Started | 30min | T053 | Handle case variations |
| T055 | Update tool-config for Sisyphus | Not Started | 45min | T054 | Tool restrictions for Sisyphus |
| T056 | Add environment context injection for Sisyphus | Not Started | 30min | T055 | Same as OmO injection |
| T057 | Test OmO still works as default | Not Started | 30min | T056 | Regression test |
| T058 | Test Sisyphus can be enabled via config | Not Started | 30min | T057 | `primary_orchestrator: "Sisyphus"` |
| T059 | Test both agents have correct role permissions | Not Started | 30min | T058 | Verify team-lead capabilities |
| T060 | Run typecheck | Not Started | 10min | T059 | Must pass |
| T061 | Create checkpoint tag `checkpoint-phase-3` | Not Started | 5min | T060 | For rollback capability |

**Checkpoint Gate 3**:
- [ ] `bun run typecheck` passes
- [ ] OmO agent works as before (default)
- [ ] Sisyphus agent can be enabled via config
- [ ] Both agents have correct role permissions
- [ ] Agent coexistence logic works correctly

---

## Phase 3.5: Agent Architecture Migration (6h) [NEW - CRITICAL]

**Goal**: Migrate OmO to Sisyphus base architecture + fork-specific extensions for long-term maintainability

**Why This Phase**:
- Sisyphus uses dynamic `buildXxxSection()` pattern (more maintainable)
- Our OmO uses static ~1100 line prompt (harder to maintain)
- Without migration, every upstream Sisyphus improvement requires manual porting
- Migration now prevents exponential divergence and simplifies future syncs

**Dependency Analysis**: See `context/memory/omo-sisyphus-dependency-analysis.md` for detailed 21-section analysis.

**Key Findings to Handle**:
- **Todo⇄Spec Cycle**: Mutual references between sections - handle with neutral data flow
- **Taxonomy Coupling**: Reference Sisyphus base taxonomy where possible
- **Incremental Extension**: We're extracting fork-unique additions, not decomposing all 21 sections

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T061.1 | Analyze current OmO prompt sections | Not Started | 30min | T061 | Reference `omo-sisyphus-dependency-analysis.md` - maps 21 sections |
| T061.2 | Document Sisyphus sections vs OmO unique sections | Not Started | 30min | T061.1 | Focus on 6 sections needing extraction (see analysis) |
| T061.3 | Create src/agents/sisyphus-fork-extensions.ts scaffolding | Not Started | 15min | T061.2 | Basic file structure with exports |
| T061.4 | Extract buildGovernanceSection() | Not Started | 45min | T061.3 | Lines ~960-1003 from omo.ts |
| T061.5 | Extract buildSpecWorkflowSection() | Not Started | 45min | T061.4 | Lines ~1005-1110 - **handle Todo⇄Spec cycle** by emitting data, not cross-referencing |
| T061.6 | Extract buildLinearIntegrationSection() | Not Started | 30min | T061.5 | Linear-specific decision matrix entries |
| T061.7 | Extract buildIntentGateExtensions() | Not Started | 45min | T061.6 | Spec folder decision logic - reference Sisyphus taxonomy |
| T061.8 | Extract buildDecisionMatrixExtensions() | Not Started | 30min | T061.7 | Consider deriving from Intent_Gate to prevent drift |
| T061.9 | Create composeForkExtensions() combiner function | Not Started | 15min | T061.8 | Combines all sections in correct order |
| T061.10 | Refactor omo.ts to use Sisyphus base + extensions | Not Started | 45min | T061.9 | createOmoAgent() = Sisyphus + fork extensions |
| T061.11 | Update src/agents/index.ts exports | Not Started | 15min | T061.10 | Export new files correctly |
| T061.12 | Create regression test for OmO prompt output | Not Started | 30min | T061.11 | Verify prompt equivalent to previous |
| T061.13 | Test spec folder detection still works | Not Started | 15min | T061.12 | Manual test with Linear issue |
| T061.14 | Test governance tools still work | Not Started | 15min | T061.13 | linear_branch, create_spec_folder |
| T061.15 | Test Ralph Loop compatibility | Not Started | 15min | T061.14 | Verify hook works with new OmO |
| T061.16 | Run typecheck | Not Started | 10min | T061.15 | Must pass |
| T061.17 | Create checkpoint tag `checkpoint-phase-3.5` | Not Started | 5min | T061.16 | For rollback capability |

**Files to Create**:
- `src/agents/sisyphus-fork-extensions.ts` (~500 lines) - Our unique builder functions
- Update `src/agents/omo.ts` (~50 lines) - Thin wrapper composing Sisyphus + extensions

**Files from Upstream (DO NOT MODIFY)**:
- `src/agents/sisyphus.ts` - Base agent implementation
- `src/agents/sisyphus-prompt-builder.ts` - Base builder functions

**Checkpoint Gate 3.5**:
- [ ] `src/agents/sisyphus-fork-extensions.ts` created with all 5 builder functions
- [ ] `src/agents/omo.ts` refactored to compose Sisyphus + extensions
- [ ] OmO prompt functionally equivalent to previous static version
- [ ] Spec folder detection works (test with "work on LIF-111")
- [ ] Governance tools work (linear_branch, create_spec_folder)
- [ ] Ralph Loop hook compatible with new architecture
- [ ] `bun run typecheck` passes
- [ ] No behavior regression from user perspective

**Time Buffer Note**: If Todo⇄Spec cycle extraction proves complex, budget additional 2-4h.

---

## Phase 3.5.1: Architecture Cleanup (OPTIONAL - 4-8h)

**This phase is OPTIONAL** - not required for the sync but recommended for long-term maintainability. Can be a separate Linear issue post-sync.

| ID | Task | Status | Estimate | Priority | Notes |
|----|------|--------|----------|----------|-------|
| T061.18 | Extract shared Taxonomy module | Not Started | 2h | Medium | Task types, scope levels as shared constants |
| T061.19 | Break Todo⇄Spec cycle with artifact pattern | Not Started | 2h | Medium | Spec emits tasksList, Todo consumes |
| T061.20 | Auto-generate Decision_Matrix from Intent_Gate | Not Started | 1.5h | Low | Add generation script + lint step |
| T061.21 | Define formal Evidence schema | Not Started | 1h | Low | What constitutes valid evidence? |
| T061.22 | Unify governance constraints | Not Started | 1.5h | Low | Anti_Patterns + Gates + Verification |

**When to Execute**: After sync complete and stable. Create separate Linear issue.

**Checkpoint Gate 3.5.1** (OPTIONAL):
- [ ] Taxonomy module created and imported everywhere
- [ ] Todo⇄Spec cycle broken
- [ ] Decision_Matrix generated (not manually maintained)
- [ ] Evidence schema documented
- [ ] No regression in agent behavior

---

## Phase 4: Hook Integration (10h)

**Goal**: Add 5 new upstream hooks and update existing hooks with fixes

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T062 | Create src/hooks/empty-message-sanitizer/ | Not Started | 1h | T061 | **EASIEST** - Start here (~60 lines) |
| T063 | Create index.ts, types.ts, constants.ts | Not Started | 15min | T062 | Standard hook structure |
| T064 | Implement createEmptyMessageSanitizerHook | Not Started | 30min | T063 | Message content validation |
| T065 | Test empty-message-sanitizer | Not Started | 15min | T064 | Unit tests |
| T066 | Create src/hooks/thinking-block-validator/ | Not Started | 1.5h | T065 | Pattern matching (~80 lines) |
| T067 | Create index.ts, types.ts, constants.ts | Not Started | 15min | T066 | Standard hook structure |
| T068 | Implement createThinkingBlockValidatorHook | Not Started | 45min | T067 | Thinking block validation |
| T069 | Test thinking-block-validator | Not Started | 30min | T068 | Unit tests |
| T070 | Create src/hooks/compaction-context-injector/ | Not Started | 1.5h | T069 | Context integration (~120 lines) |
| T071 | Create index.ts, types.ts, constants.ts | Not Started | 15min | T070 | Standard hook structure |
| T072 | Implement createCompactionContextInjectorHook | Not Started | 1h | T071 | Context summary injection |
| T073 | Test compaction-context-injector | Not Started | 15min | T072 | Unit tests |
| T074 | Create src/hooks/preemptive-compaction/ | Not Started | 2h | T073 | **COMPLEX** - Token monitoring (~150 lines) |
| T075 | Create index.ts, types.ts, constants.ts | Not Started | 15min | T074 | Standard hook structure |
| T076 | Implement createPreemptiveCompactionHook | Not Started | 1.5h | T075 | 85% threshold auto-compact |
| T077 | Test preemptive-compaction | Not Started | 15min | T076 | Unit tests |
| T078 | Update src/hooks/session-recovery/ with upstream fixes | Not Started | 1.5h | T077 | Apply recovery pipeline improvements |
| T079 | Update src/hooks/anthropic-auto-compact/ (DCP) | Not Started | 1h | T078 | Add DCP for compaction option |
| T080 | Update src/hooks/index.ts (manual merge) | Not Started | 45min | T079 | Export all new hooks |
| T081 | Add new hooks to HookHealthManager | Not Started | 15min | T080 | Register for health monitoring |
| T082 | Wire hooks in correct order in src/index.ts | Not Started | 1h | T081 | **CRITICAL** - Order matters |
| T083 | Test hook ordering (no races) | Not Started | 30min | T082 | Verify execution order |
| T084 | Run full test suite | Not Started | 15min | T083 | All hook tests must pass |
| T085 | Create checkpoint tag `checkpoint-phase-4` | Not Started | 5min | T084 | For rollback capability |

**Checkpoint Gate 4**:
- [ ] `bun run typecheck` passes
- [ ] `bun test` passes (all hook tests)
- [ ] Preemptive compaction triggers at 85%
- [ ] Thinking-block-validator prevents errors
- [ ] Hook ordering is correct (no races)
- [ ] All 5 new hooks functional

---

## Phase 4.5: New Features (v2.12.4 - v2.13.2) (8h) [NEW]

**Goal**: Integrate new features from versions 2.12.4 through 2.13.2

### 4.5.1: Background Agent Concurrency (2h)

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T085.1 | Create src/features/background-agent/concurrency.ts | Not Started | 45min | T085 | ~66 lines - Model-based limits |
| T085.2 | Create src/features/background-agent/concurrency.test.ts | Not Started | 45min | T085.1 | ~351 lines of tests |
| T085.3 | Update src/features/background-agent/types.ts | Not Started | 10min | T085.2 | Add concurrency types |
| T085.4 | Update src/features/background-agent/manager.ts | Not Started | 30min | T085.3 | Integrate concurrency |
| T085.5 | Update assets/oh-my-opencode.schema.json | Not Started | 15min | T085.4 | Add concurrency config |
| T085.6 | Update src/config/schema.ts | Not Started | 15min | T085.5 | Add concurrency schema |

### 4.5.2: /refactor Command (3h)

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T085.7 | Create src/features/builtin-commands/templates/refactor.ts | Not Started | 2h | T085.6 | **624 lines** - LSP/AST refactoring |
| T085.8 | Update src/features/builtin-commands/commands.ts | Not Started | 15min | T085.7 | Register refactor command |
| T085.9 | Update src/features/builtin-commands/types.ts | Not Started | 10min | T085.8 | Add refactor types |
| T085.10 | Test /refactor command manually | Not Started | 30min | T085.9 | Verify LSP operations |

### 4.5.3: Critical Bug Fixes (v2.13.x) (2h)

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T085.11 | Fix session-notification Bun shell GC crash (4a38e70) | Not Started | 30min | T085.10 | Use node:child_process |
| T085.12 | Fix recursive subagent prevention (375e7f7) | Not Started | 30min | T085.11 | call_omo_agent guard |
| T085.13 | Fix skill content lazy loading (ad44af9) | Not Started | 20min | T085.12 | slashcommand tool |
| T085.14 | Fix zsh verification for hook execution (d331b48) | Not Started | 20min | T085.13 | Hook utilities |
| T085.15 | Run typecheck after all fixes | Not Started | 10min | T085.14 | Must pass |
| T085.16 | Create checkpoint tag `checkpoint-phase-4.5` | Not Started | 5min | T085.15 | For rollback capability |

### 4.5.4: Slashcommand & MCP Updates (1h)

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T085.17 | Update slashcommand with options/caching (4e5b356) | Not Started | 30min | T085.16 | Tool improvements |
| T085.18 | Restore Exa websearch MCP support (a2bfb5e) | Not Started | 20min | T085.17 | MCP config |
| T085.19 | Update librarian prompt for conditional web search | Not Started | 10min | T085.18 | Agent prompt |

**Checkpoint Gate 4.5**:
- [ ] Background agent concurrency limits work per model
- [ ] /refactor command executes LSP/AST operations correctly
- [ ] Session notification doesn't cause Bun shell GC crash
- [ ] Recursive subagent spawning is prevented
- [ ] Skill content loads lazily in slashcommand
- [ ] zsh existence verified before hook execution
- [ ] Exa websearch MCP restored and functional
- [ ] `bun run typecheck` passes

---

## Phase 5: Tools & Features Integration (8h)

**Goal**: Add session-manager tool and update existing tools while preserving fork tools

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T086 | Create src/tools/session-manager/ directory | Not Started | 15min | T085 | Standard tool structure |
| T087 | Create index.ts, types.ts, constants.ts | Not Started | 30min | T086 | Tool boilerplate |
| T088 | Implement createSessionManagerTool | Not Started | 1.5h | T087 | Session listing, filtering, storage |
| T089 | Test session-manager tool | Not Started | 30min | T088 | Unit tests |
| T090 | Update src/tools/skill/ with MCP display | Not Started | 1h | T089 | Show MCP server capabilities |
| T091 | Create src/features/builtin-commands/ | Not Started | 30min | T090 | Directory structure |
| T092 | Add init-deep template | Not Started | 30min | T091 | From upstream |
| T093 | Add ralph-loop template | Not Started | 30min | T092 | From upstream |
| T094 | Update src/features/index.ts | Not Started | 15min | T093 | Export builtin-commands |
| T095 | Update src/tools/index.ts (manual merge) | Not Started | 45min | T094 | Add session-manager, keep all fork tools |
| T096 | Verify Linear tools preserved | Not Started | 30min | T095 | Test all 7 Linear tools |
| T097 | Verify sync-fork tool preserved | Not Started | 15min | T096 | Test sync-fork functionality |
| T098 | Verify memory tools preserved | Not Started | 15min | T097 | Test memory management |
| T099 | Verify spec tools preserved | Not Started | 15min | T098 | Test spec folder creation |
| T100 | Verify extract-learnings tool preserved | Not Started | 15min | T099 | Test meta-learning extraction |
| T101 | Run typecheck | Not Started | 10min | T100 | Must pass |
| T102 | Run build | Not Started | 10min | T101 | Must succeed |
| T103 | Create checkpoint tag `checkpoint-phase-5` | Not Started | 5min | T102 | For rollback capability |

**Checkpoint Gate 5**:
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] All 7 Linear tools functional
- [ ] All fork custom tools functional (sync-fork, memory, spec, extract-learnings)
- [ ] New upstream tools functional (session-manager)
- [ ] No tool name collisions

---

## Phase 6: Main Plugin Wiring (6h)

**Goal**: Merge src/index.ts with correct hook ordering and agent initialization

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T104 | Backup current src/index.ts | Not Started | 5min | T103 | Safety copy |
| T105 | Analyze upstream src/index.ts changes | Not Started | 30min | T104 | Document new initializations |
| T106 | Add new hook initializations | Not Started | 45min | T105 | preemptive-compaction, etc. |
| T107 | Add experimental config handling | Not Started | 30min | T106 | Read experimental section |
| T108 | Add Sisyphus agent initialization | Not Started | 45min | T107 | Alongside OmO |
| T109 | Update agent registration logic | Not Started | 30min | T108 | primary_orchestrator handling |
| T110 | Update hook wiring order | Not Started | 45min | T109 | **CRITICAL** - Correct order |
| T111 | Add new tool initializations | Not Started | 30min | T110 | session-manager, etc. |
| T112 | Verify all hooks wired correctly | Not Started | 30min | T111 | Manual review |
| T113 | Verify all tools exported | Not Started | 15min | T112 | Check tool registry |
| T114 | Verify config loading order | Not Started | 15min | T113 | Check precedence |
| T115 | Run typecheck | Not Started | 10min | T114 | Must pass |
| T116 | Run build | Not Started | 10min | T115 | Must succeed |
| T117 | Run full test suite | Not Started | 15min | T116 | All tests must pass |
| T118 | Integration test: Start OpenCode with plugin | Not Started | 30min | T117 | Manual verification |
| T119 | Integration test: OmO agent responds | Not Started | 15min | T118 | Test delegation |
| T120 | Integration test: /commit command | Not Started | 15min | T119 | Test command execution |
| T121 | Integration test: Linear issue creation | Not Started | 15min | T120 | Test Linear integration |
| T122 | Integration test: Background agent delegation | Not Started | 15min | T121 | Test background tasks |
| T123 | Verify context tokens < 12k | Not Started | 10min | T122 | Performance check |
| T124 | Create checkpoint tag `checkpoint-phase-6` | Not Started | 5min | T123 | For rollback capability |

**Checkpoint Gate 6**:
- [ ] `bun run typecheck` passes
- [ ] `bun run build` passes
- [ ] `bun test` passes (all tests)
- [ ] Full integration test passes
- [ ] OmO agent functional
- [ ] Linear integration functional
- [ ] Background tasks functional
- [ ] Context tokens ≤ 12k

---

## Phase 7: Documentation & Cleanup (4h)

**Goal**: Update all documentation and create migration notes

| ID | Task | Status | Estimate | Dependencies | Notes |
|----|------|--------|----------|--------------|-------|
| T125 | Update AGENTS.md with new capabilities | Not Started | 1h | T124 | Add Sisyphus, new hooks, new tools |
| T126 | Update README.md with new features | Not Started | 45min | T125 | Document Sisyphus, experimental features |
| T127 | Update README.ko.md | Not Started | 15min | T126 | Korean translation updates |
| T128 | Update README.ja.md | Not Started | 15min | T127 | Japanese translation updates |
| T129 | Create docs/guides/upstream-sync-migration.md | Not Started | 45min | T128 | Migration notes for users |
| T130 | Update changelog/ with sync entry | Not Started | 30min | T129 | Document all synced changes |
| T131 | Remove FORK_CUSTOMIZATIONS.md (if temporary) | Not Started | 5min | T130 | Cleanup |
| T132 | Final typecheck | Not Started | 10min | T131 | Must pass |
| T133 | Final build | Not Started | 10min | T132 | Must succeed |
| T134 | Final test suite | Not Started | 15min | T133 | All tests must pass |
| T135 | Verify context tokens ≤ 12k | Not Started | 10min | T134 | Performance check |
| T136 | Verify all Linear tools functional (7/7) | Not Started | 15min | T135 | Final verification |
| T137 | Verify all spec folders preserved (27/27) | Not Started | 10min | T136 | Final verification |
| T138 | Create final checkpoint tag `checkpoint-phase-7` | Not Started | 5min | T137 | For rollback capability |
| T139 | Merge sync branch to main | Not Started | 15min | T138 | **FINAL STEP** |

**Checkpoint Gate 7 (FINAL)**:
- [ ] `bun run typecheck` passes (0 errors)
- [ ] `bun run build` passes
- [ ] `bun test` passes (all tests)
- [ ] All documentation updated
- [ ] Context tokens ≤ 12k at startup
- [ ] All 7 Linear tools functional
- [ ] All 27 spec folders preserved
- [ ] Sisyphus agent available
- [ ] Backward config compatibility verified

---

## Summary (Updated 2026-01-06 - Post Analysis Review)

| Phase | Tasks | Estimate | Status | Critical Path |
|-------|-------|----------|--------|---------------|
| Phase 0: Preparation | 11 tasks | 2h | Not Started | T001 → T010 |
| Phase 1: Critical Bug Fixes | 15 tasks | 4h | Not Started | T012 → T026 |
| **Phase 1.5: OpenCode 1.1.1 Compat** | **11 tasks** | ~~6h~~ **1.5h** | **75% Complete** | **T026.1 → T026.11** |
| Phase 2: Dependencies & Schema | 20 tasks | 6h | Not Started | T027 → T046 |
| Phase 3: Agent Integration | 15 tasks | 8h | Not Started | T047 → T061 |
| **Phase 3.5: Agent Architecture Migration** | **17 tasks** | **6h (+2-4h buffer)** | **Not Started** | **T061.1 → T061.17** |
| *Phase 3.5.1: Architecture Cleanup* | *5 tasks* | *4-8h* | *OPTIONAL* | *T061.18 → T061.22* |
| Phase 4: Hook Integration | 24 tasks | 10h | Not Started | T062 → T085 |
| **Phase 4.5: New Features (v2.12.4-v2.13.2)** | **19 tasks** | **8h** | **Not Started** | **T085.1 → T085.19** |
| Phase 5: Tools & Features | 18 tasks | 8h | Not Started | T086 → T103 |
| Phase 6: Main Plugin Wiring | 21 tasks | 6h | Not Started | T104 → T124 |
| Phase 7: Documentation & Cleanup | 15 tasks | 4h | Not Started | T125 → T139 |
| **TOTAL (Required)** | **186 tasks** | **63.5h** | - | - |
| **TOTAL (with Optional)** | **191 tasks** | **67.5-71.5h** | - | - |
| **Buffer (20%)** | - | **12.7-14.3h** | - | - |
| **GRAND TOTAL** | **186-191 tasks** | **76-86h (~10-12 days)** | - | - |

**Time Saved**: 4.5h from Phase 1.5 (merged from origin/dev on 2026-01-06)
**Time Added**: 6h for Phase 3.5 (Agent Architecture Migration) - CRITICAL for long-term maintainability
**Optional**: Phase 3.5.1 (4-8h) for deeper architectural cleanup per dependency analysis

### Key Changes Since Original Spec (106 New Commits + Architecture Decision)

| Category | Commits | Priority | New Tasks | Status |
|----------|---------|----------|-----------|--------|
| OpenCode 1.1.1 Permission Compat | 6 commits | P0 | 11 tasks | ✅ 75% Complete |
| **Agent Architecture Migration** | **Strategic** | **P0** | **17 tasks** | **Not Started** |
| Background Agent Concurrency | 1 commit | P1 | 6 tasks | Not Started |
| /refactor Command | 1 commit | P1 | 4 tasks | Not Started |
| Bug Fixes (v2.13.x) | 5 commits | P0-P1 | 5 tasks | Not Started |
| Slashcommand & MCP | 3 commits | P2 | 3 tasks | Not Started |
| **Total New** | **16 key commits + 1 strategy** | - | **47 tasks** | - |

### Agent Architecture Migration (Phase 3.5 - NEW)

**Decision**: Migrate OmO to Sisyphus base + fork extensions (see DD-1 in spec.md)
**Analysis**: See `context/memory/omo-sisyphus-dependency-analysis.md` for 21-section deep dive

| Builder Function | Purpose | ~Lines | Extraction Difficulty |
|------------------|---------|--------|----------------------|
| `buildGovernanceSection()` | Linear tools, path validation, historian | 100 | Easy |
| `buildSpecWorkflowSection()` | tasks.md → todos, spec folder detection | 150 | **Hard** (cycle) |
| `buildLinearIntegrationSection()` | Linear issue handling, branch naming | 80 | Medium |
| `buildIntentGateExtensions()` | Spec folder decisions by task type | 120 | **Hard** (hub) |
| `buildDecisionMatrixExtensions()` | Extended matrix with Linear/spec | 60 | Medium (drift risk) |
| **Total** | | **~510** | |

**Approach: Incremental Extension (not Full Decomposition)**:
- Analysis suggests 10-20h for full modular decomposition of all 21 sections
- We're doing targeted extraction of 5-6 fork-unique additions (~6h)
- Optional Phase 3.5.1 (4-8h) for deeper cleanup if desired post-sync

**Key Findings from Analysis**:
1. **Todo⇄Spec Cycle**: Handle by having Spec emit data, Todo consume (not cross-reference)
2. **Taxonomy Coupling**: Reference Sisyphus's base taxonomy where possible
3. **Decision_Matrix Drift**: Consider deriving from Intent_Gate additions

**Why Critical**:
- Upstream Sisyphus uses dynamic builder pattern (easy to extend/maintain)
- Our static OmO prompt is hard to merge with upstream changes
- Migration enables cherry-picking upstream improvements
- Prevents exponential divergence between fork and upstream

---

## Recommended Execution Order

### Critical Path (Must be Sequential) - Updated 2026-01-06

```
T001 (backup) → T010 (sync branch) → T011 (checkpoint)
    ↓
T012-T026 (bug fixes - sequential cherry-picks)
    ↓
T026.1-T026.11 (OpenCode 1.1.1 compat - PHASE 1.5)
    ↓
T027-T046 (schema - sequential dependency)
    ↓
T047-T061 (agents - Sisyphus depends on schema)
    ↓
T061.1-T061.17 (agent architecture migration - PHASE 3.5)  ← NEW CRITICAL PATH
    ↓
T062-T085 (hooks - depends on migrated agent architecture)
    ↓
T085.1-T085.19 (new features v2.12.4-v2.13.2 - PHASE 4.5)
    ↓
T086-T103 (tools - depends on hooks for integration)
    ↓
T104-T124 (wiring - depends on all above)
    ↓
T125-T139 (docs - final step)
```

**Phase 3.5 (Agent Architecture Migration) is on the critical path because**:
- OmO must be migrated BEFORE hooks integration (Phase 4)
- Hooks may reference agent capabilities that depend on new architecture
- Testing must verify spec/Linear workflows work with migrated OmO

### Parallelizable Tasks

**Within Phase 4 (Hooks)**:
- T062-T065 (empty-message-sanitizer) can run parallel with T066-T069 (thinking-block-validator)
- T070-T073 (compaction-context-injector) can run parallel with T074-T077 (preemptive-compaction)

**Within Phase 5 (Tools)**:
- T096-T100 (verification tasks) can run in parallel

**Within Phase 7 (Docs)**:
- T126-T128 (README updates) can run in parallel

---

## Dependency Graph

```
Phase 0 ──────────────────────────────────────────────────────────────────────┐
  T001 (backup) ─┬─ T002 (push)                                               │
                 └─ T003 (rerere) ─┬─ T004 (upstream) ─ T005 (analyze)        │
                                   │                                          │
  T006 (doc customizations) ───────┼─ T007 (Linear baseline)                  │
                                   │                                          │
  T008 (spec baseline) ────────────┼─ T009 (token baseline)                   │
                                   │                                          │
                                   └─ T010 (sync branch) ─ T011 (checkpoint)  │
                                                                              │
Phase 1 ──────────────────────────────────────────────────────────────────────┤
  T012 ─ T013 ─ T014 ─ T015 ─ T016 ─ T017 ─ T018 ─ T019 ─ T020 ─ T021 ─ T022  │
                                                                    │         │
  T023 (test) ─ T024 (build) ─ T025 (tokens) ─ T026 (checkpoint) ───┘         │
                                                                              │
Phase 2 ──────────────────────────────────────────────────────────────────────┤
  T027 ─ T028 ─ T029 ─ T030 ─ T031 ─ T032 ─ T033 ─ T034 ─ T035 ─ T036 ─ T037  │
                                                                    │         │
  T038 ─ T039 ─ T040 ─ T041 ─ T042 ─ T043 ─ T044 ─ T045 ─ T046 ─────┘         │
                                                                              │
Phase 3 ──────────────────────────────────────────────────────────────────────┤
  T047 (sisyphus.ts) ─ T048 (prompt-builder) ─ T049 ─ T050 ─ T051 ─ T052      │
                                                                    │         │
  T053 ─ T054 ─ T055 ─ T056 ─ T057 ─ T058 ─ T059 ─ T060 ─ T061 ─────┘         │
                                                                              │
Phase 4 ──────────────────────────────────────────────────────────────────────┤
  T062-T065 (empty-msg) ──┬── T070-T073 (compaction-ctx) ──┬── T078 (recovery)│
  T066-T069 (thinking) ───┘   T074-T077 (preemptive) ──────┘                  │
                                                                    │         │
  T079 ─ T080 ─ T081 ─ T082 ─ T083 ─ T084 ─ T085 ───────────────────┘         │
                                                                              │
Phase 5 ──────────────────────────────────────────────────────────────────────┤
  T086 ─ T087 ─ T088 ─ T089 ─ T090 ─ T091 ─ T092 ─ T093 ─ T094 ─ T095         │
                                                                    │         │
  T096 ─┬─ T097 ─┬─ T098 ─┬─ T099 ─┬─ T100 ─ T101 ─ T102 ─ T103 ────┘         │
        └────────┴────────┴────────┘ (parallel verification)                  │
                                                                              │
Phase 6 ──────────────────────────────────────────────────────────────────────┤
  T104 ─ T105 ─ T106 ─ T107 ─ T108 ─ T109 ─ T110 ─ T111 ─ T112 ─ T113 ─ T114  │
                                                                    │         │
  T115 ─ T116 ─ T117 ─ T118 ─ T119 ─ T120 ─ T121 ─ T122 ─ T123 ─ T124 ──┘     │
                                                                              │
Phase 7 ──────────────────────────────────────────────────────────────────────┘
  T125 (AGENTS.md) ─ T126 ─┬─ T127 ─┬─ T129 ─ T130 ─ T131
                           └─ T128 ─┘ (parallel READMEs)
                                                    │
  T132 ─ T133 ─ T134 ─ T135 ─ T136 ─ T137 ─ T138 ─ T139 (merge)
```

---

## Risk Mitigation

| Risk | Tasks Affected | Mitigation |
|------|----------------|------------|
| Cherry-pick conflicts | T012-T022 | Use `git cherry-pick -x`, resolve manually |
| Schema breaking changes | T032-T045 | Test with existing configs after each change |
| Hook ordering issues | T082-T083 | Follow plan.md hook execution order exactly |
| Linear integration breaks | T096, T121, T136 | Test all 7 tools at each checkpoint |
| Build failures | T024, T102, T116, T133 | Rollback to previous checkpoint |
| Context token regression | T025, T123, T135 | Measure at each phase, target ≤12k |

---

## Rollback Triggers

**Abort and rollback if ANY of these occur:**
- [ ] Typecheck has 100+ errors across unrelated files
- [ ] Config parsing breaks for known-good fork configs
- [ ] Linear integration tests fail
- [ ] Build output size increases >50%
- [ ] Context tokens exceed 15k at startup

**Rollback Command:**
```bash
git reset --hard checkpoint-phase-(N-1)
```

---

## Notes

### Complexity Insights (from codebase analysis)

- **Hooks**: 31 existing hooks, ~600-700 lines for 5 new hooks
- **Agents**: 28 existing agents, Sisyphus follows same pattern as OmO
- **Tools**: 32+ existing tools, session-manager follows standard pattern
- **Schema**: 389 lines, 24 Zod schemas, well-structured for extension
- **Main Plugin**: 748 lines, 34 hooks wired, complex but modular

### Files to Preserve (CRITICAL)

- `.cursor/memory/*` - All documentation files
- `.cursor/specs/*` - All 27 spec folders
- `src/tools/linear/*` - All 7 Linear tools
- `src/tools/sync-fork/*` - Sync fork tool
- `src/tools/memory/*` - Memory management tools
- `src/tools/spec/*` - Spec folder tools
- `src/tools/extract-learnings/*` - Meta-learning tool
- `.opencode/agent/*.md` - 18 custom agent definitions
- `.opencode/command/*.md` - Custom commands
- `changelog/*` - Session changelogs
- `context/learnings/*` - Context learnings

### Success Metrics

| Metric | Target |
|--------|--------|
| TypeScript errors | 0 |
| Build failures | 0 |
| Test failures | 0 |
| Context tokens at startup | ≤12k |
| Linear tools functional | 7/7 |
| Spec folders preserved | 27/27 |
| Upstream hooks integrated | 5+ |
| Sisyphus agent available | Yes |
| Backward config compatibility | 100% |
