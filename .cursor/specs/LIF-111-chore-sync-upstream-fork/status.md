# sync-upstream-fork - Status

**Linear Issue**: [LIF-111](https://linear.app/lifelogger/issue/LIF-111/sync-fork-with-upstream-code-yeongyuoh-my-opencode-397-commits)
**Last Updated**: 2026-01-06 (3rd update - Architecture Migration Strategy)

## Current Status

- **Phase**: Phase 1.5 Mostly Complete (via origin/dev merge)
- **Progress**: 28% (revised with new Phase 3.5)
- **Blockers**: None
- **Major Decision**: Agent Architecture Migration approved (see DD-1 revision)

## Latest Merge (2026-01-06)

Pulled latest changes from `origin/dev` branch:

| Commit | Description | Files Changed |
|--------|-------------|---------------|
| `4e30f83` | feat(compat): add OpenCode 1.1.1 permission system compatibility | 30 files |

**Impact**: Phase 1.5 is now **75% complete**. Core OpenCode 1.1.1 compatibility layer already implemented in our fork.

### Files Added in Merge
- `src/shared/opencode-version.ts` (110 lines) - Version detection
- `src/shared/permission-compat.ts` (79 lines) - Permission format converter
- `context/memory/opencode-1.1.1-research.md` (452 lines)
- `context/memory/opencode-1.1.1-sync-analysis.md` (78 lines)
- `context/memory/v2.12.3-upstream-analysis.md` (383 lines)
- `context/memory/workflow-patterns-analysis.md` (511 lines)

### Agents Updated in Merge (20+ files)
All specialist agents now use permission compatibility layer.

---

## Summary of Changes

### Update (2026-01-06)

Discovered **106 new upstream commits** since spec creation on Jan 2, 2026. Major changes include:

| Category | Details |
|----------|---------|
| **OpenCode 1.1.1 Compat** | Permission system overhaul requiring compat layer for all agents |
| **Background Agent Concurrency** | Model-based limits to prevent rate limiting |
| **New /refactor Command** | 624-line LSP/AST-based intelligent refactoring |
| **Critical Bug Fixes** | Session notification GC crash, recursive subagent prevention |
| **New Releases** | v2.12.4, v2.13.0, v2.13.1, v2.13.2 |

### Spec Updates Made

- ✅ **spec.md**: Added Addendum section with 106 new commits analysis
- ✅ **tasks.md**: Added Phase 1.5 (OpenCode 1.1.1 Compat) and Phase 4.5 (v2.12.4-v2.13.2 Features)
- ✅ **plan.md**: Added new phases, updated time estimates, added change log
- ✅ **status.md**: Updated with current progress

### Updated Estimates

| Original | After 106 Commits | After Architecture Decision | Delta |
|----------|-------------------|-----------------------------| ------|
| 7 phases | 9 phases | **11 phases** | +4 phases |
| 139 tasks | 169 tasks | **186 tasks** | +47 tasks |
| 48-56h | 62-74h | **76.2h** | +20-28h |
| 7-9 days | 9-11 days | **10-12 days** | +3-4 days |

**Note**: Phase 3.5 (Agent Architecture Migration) adds 17 tasks and 6h but is CRITICAL for long-term maintainability. The time investment now saves exponential time on future syncs.

## Recent Updates

- 2026-01-06: **Dependency Analysis Review** - Reviewed `omo-sisyphus-dependency-analysis.md` findings. Confirmed incremental extension approach (6h) vs full decomposition (10-20h). Added optional Phase 3.5.1 (4-8h) for deeper cleanup. Updated tasks with cycle handling notes.
- 2026-01-06: **MAJOR: Agent Architecture Migration Strategy** - Revised DD-1 from "coexistence" to "migration". Added Phase 3.5 (17 tasks, 6h). OmO will be built on Sisyphus base + fork extensions.
- 2026-01-06: **Merged origin/dev** - OpenCode 1.1.1 permission compat layer (Phase 1.5 now 75% complete)
- 2026-01-06: Spec update with 106 new commits analysis (OpenCode 1.1.1 compat, v2.12.4-v2.13.2 features)
- 2026-01-02: Comprehensive implementation plan created (7 phases, 48-56h estimated)
- 2026-01-02: Deep analysis completed with 10+ research agents + 3 oracle consultations
- 2026-01-02: Spec folder created

## Architecture Migration Decision (2026-01-06)

**Problem**: Upstream uses Sisyphus with dynamic `buildXxxSection()` pattern. Our OmO has ~1100 lines of static prompt with unique customizations (spec workflow, Linear integration, governance). Keeping them separate means:
- Every upstream Sisyphus improvement requires manual porting
- Double maintenance burden
- Sync confusion grows exponentially

**Solution**: Migrate OmO to Sisyphus base + fork-specific extensions:
```
src/agents/
├── sisyphus.ts                    # FROM UPSTREAM (sync-able)
├── sisyphus-prompt-builder.ts     # FROM UPSTREAM (sync-able)
├── sisyphus-fork-extensions.ts    # FORK-ONLY (~500 lines)
│   ├── buildGovernanceSection()
│   ├── buildSpecWorkflowSection()
│   ├── buildLinearIntegrationSection()
│   ├── buildIntentGateExtensions()
│   └── buildDecisionMatrixExtensions()
└── omo.ts                         # THIN WRAPPER (~50 lines)
    └── createOmoAgent() = Sisyphus + extensions
```

**Benefits**:
- Upstream changes auto-apply to base
- Our customizations isolated in fork-only files
- Future syncs become cherry-picks, not rewrites
- All unique functionality preserved

**Dependency Analysis Findings** (see `context/memory/omo-sisyphus-dependency-analysis.md`):
- OmO has 21 sections, ~1125 lines of prompt
- Key challenges: Todo⇄Spec cyclic dependency, taxonomy coupling, Decision_Matrix drift
- Analysis recommends 10-20h for full decomposition
- **Our approach**: Incremental extension (6h) + optional cleanup (4-8h)
- Focus on extracting 5 fork-unique builder functions, not decomposing all 21 sections

## Key Decisions

1. **~~Agent Coexistence~~** → **Agent Architecture Migration** (REVISED 2026-01-06):
   - **OLD**: Keep both OmO and Sisyphus as separate agents
   - **NEW**: Migrate OmO to Sisyphus base + fork-specific extensions
   - **WHY**: Reduces long-term maintenance, enables upstream sync cherry-picks
   - **HOW**: Extract OmO's unique sections into `sisyphus-fork-extensions.ts` builder functions
   - See DD-1 revision in spec.md for full rationale

2. **Merge Strategy**: Phased manual merge (ours as base, selective theirs)
3. **Critical Fixes First**: Cherry-pick bug fixes before feature integration
4. **Backward Compatibility**: All existing fork configs must continue working
5. **OpenCode 1.1.1 Compat**: Must implement permission compat layer BEFORE Phase 2
6. **Background Concurrency**: Add model-based limits to prevent rate limiting
7. **Fork Extensions Pattern** (NEW): All fork-specific customizations go in dedicated files that are NEVER synced from upstream

## Priority Order (Critical Path)

1. **P0 (CRITICAL)**: Phase 1.5 - OpenCode 1.1.1 permission system compatibility
2. **P0 (CRITICAL)**: Phase 4.5.3 - Bug fixes (GC crash, recursive subagents)
3. **P1 (HIGH)**: Phase 1 - Original critical bug fixes
4. **P1 (HIGH)**: Phase 4.5.1-4.5.2 - Background concurrency, /refactor command
5. **P2 (MEDIUM)**: Remaining phases as planned

## Next Steps

1. ✅ Update spec documents with new upstream changes
2. ✅ Merge origin/dev with OpenCode 1.1.1 compat layer
3. ✅ Decide on agent architecture migration strategy (DD-1 revision)
4. ✅ Update all spec documents with Phase 3.5 (Agent Architecture Migration)
5. ⏳ Complete Phase 1.5 remaining tasks:
   - Sync permission compat tests from upstream
   - Run typecheck verification
   - Create checkpoint tag
6. ⏳ Begin Phase 0: Preparation (backup branch, fetch upstream)
7. ⏳ Execute Phase 1: Critical Bug Fixes (cherry-picks)
8. ⏳ Execute Phase 2: Dependencies & Schema
9. ⏳ Execute Phase 3: Agent Integration (add Sisyphus from upstream)
10. ⏳ **Execute Phase 3.5: Agent Architecture Migration** (CRITICAL)
11. ⏳ Execute Phase 4-7 sequentially

## Risk Update

| Risk | Status | Notes |
|------|--------|-------|
| OpenCode 1.1.1 permission breaking change | NEW | Must implement compat layer before agents will function |
| Bun shell GC crash | NEW | Session notification fix required |
| Recursive subagent spawning | NEW | call_omo_agent guard required |
| Original risks | Unchanged | See plan.md for full risk matrix |

## Phase Completion Status

| Phase | Status | Progress | Tasks |
|-------|--------|----------|-------|
| Phase 0: Preparation | Not Started | 0% | 11 |
| Phase 1: Critical Bug Fixes | Not Started | 0% | 15 |
| **Phase 1.5: OpenCode 1.1.1 Compat** | **In Progress** | **75%** | 11 |
| Phase 2: Dependencies & Schema | Not Started | 0% | 20 |
| Phase 3: Agent Integration | Not Started | 0% | 15 |
| **Phase 3.5: Agent Architecture Migration** | **Not Started** | **0%** | **17** |
| *Phase 3.5.1: Architecture Cleanup* | *OPTIONAL* | *-* | *5* |
| Phase 4: Hook Integration | Not Started | 0% | 24 |
| Phase 4.5: New Features | Not Started | 0% | 19 |
| Phase 5: Tools & Features | Not Started | 0% | 18 |
| Phase 6: Main Plugin Wiring | Not Started | 0% | 21 |
| Phase 7: Documentation | Not Started | 0% | 15 |
| **TOTAL (Required)** | - | **~28%** | **186** |
| **TOTAL (with Optional)** | - | - | **191** |

---

**Status Version**: 5.0
**Last Merge**: 2026-01-06 (origin/dev → `4e30f83`)
**Last Analysis**: 2026-01-06 (Dependency analysis review - incremental extension confirmed)
**Last Major Decision**: 2026-01-06 (Agent Architecture Migration - DD-1 revision + analysis integration)
