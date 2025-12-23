# LIF-73 Self-Improving Session Learning - Task Breakdown

**Linear Issue**: [LIF-73](https://linear.app/lifelogger/issue/LIF-73)
**Created**: 2025-12-23
**Updated**: 2025-12-23 (REVISED: Part A + Part B structure)
**Total Estimate**: ~12h

---

## PART A: Memory Tools (~4h)

### Phase 1: Memory Tools Foundation (2h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T001 | Create memory tool types (`src/tools/memory/types.ts`) | Not Started | 20m | MemoryToolInput, MemoryToolResult interfaces |
| T002 | Create memory tool constants (`src/tools/memory/constants.ts`) | Not Started | 15m | DEFAULT_MEMORY_PATH, file extensions |
| T003 | Implement file path utils (`src/tools/memory/utils.ts`) | Not Started | 25m | Path resolution, validation, subdirectory support |
| T004 | Implement 5 memory tools (`src/tools/memory/tools.ts`) | Not Started | 45m | memory_write, memory_read, memory_list, memory_edit, memory_delete |
| T005 | Export from index (`src/tools/memory/index.ts`) | Not Started | 15m | Barrel exports |

**Verification**: Manual test each tool, verify file operations work

---

### Phase 2: Memory Tools Integration (2h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T006 | Add MemoryToolsConfigSchema (`src/config/schema.ts`) | Not Started | 30m | memory_path, enabled options |
| T007 | Register tools in builtinTools (`src/tools/index.ts`) | Not Started | 15m | Add to tool exports |
| T008 | Update /update-context command (`.opencode/command/update-context.md`) | Not Started | 30m | Integrate with memory tools |
| T009 | Add context/ to governance paths (`src/hooks/governance-path-validator/`) | Not Started | 15m | Update allowed paths |
| T010 | Manual integration testing | Not Started | 30m | Test custom paths, governance |

**Verification**: Memory tools work with custom paths, governance allows writes

---

## PART B: Meta-Learning Extraction (~8h)

### Phase 3: Meta-Learning Agent (2h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T011 | Create meta-learning data types (`src/features/context-learning/types.ts`) | Not Started | 20m | MetaLearningCandidate, MetaLearningFile |
| T012 | Implement atomic file writer (`src/features/context-learning/file-writer.ts`) | Not Started | 25m | Write to .tmp, rename |
| T013 | Implement secret redactor (`src/features/context-learning/secret-redactor.ts`) | Not Started | 30m | API keys, tokens, private keys |
| T014 | Create context-learner agent (`src/agents/context-learner.ts`) | Not Started | 30m | Gemini 2.5 Flash, meta-learning focus |
| T015 | Register agent in index (`src/agents/index.ts`) | Not Started | 15m | Add to builtinAgents |

**Verification**: Manual invocation produces valid meta-learning candidates

---

### Phase 4: Pre-Compaction Hook (3h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T016 | Create hook types (`src/hooks/meta-learning-extractor/types.ts`) | Not Started | 20m | SignalScore, HookState interfaces |
| T017 | Implement multi-signal scorer (`src/hooks/meta-learning-extractor/signal-scorer.ts`) | Not Started | 60m | Strong/medium/weak signals, vetoes |
| T018 | Implement hook with pre-compaction trigger (`src/hooks/meta-learning-extractor/index.ts`) | Not Started | 60m | `experimental.session.compacting` PRIMARY |
| T019 | Register hook in index (`src/hooks/index.ts`) | Not Started | 15m | Add to hook exports |
| T020 | Test auto-trigger on compacting event | Not Started | 25m | Verify extraction BEFORE context loss |

**Verification**: Session compaction triggers extraction before context is lost

---

### Phase 5: Commands & Review Workflow (2h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T021 | Create /extract-learnings command (`.opencode/command/extract-learnings.md`) | Not Started | 45m | Manual meta-learning extraction |
| T022 | Create /review-learnings command (`.opencode/command/review-learnings.md`) | Not Started | 45m | Interactive approve/reject |
| T023 | Test end-to-end workflow | Not Started | 30m | Extract → review → /specify |

**Verification**: Full workflow works: extract → review → create feature spec

---

### Phase 6: Polish & Documentation (1h)

| ID | Task | Status | Estimate | Notes |
|----|------|--------|----------|-------|
| T024 | Write hook README (`src/hooks/meta-learning-extractor/README.md`) | Not Started | 20m | Signal scoring, pre-compaction trigger |
| T025 | Update AGENTS.md | Not Started | 15m | Add context-learner docs |
| T026 | Update config schema docs (`oh-my-opencode.schema.json`) | Not Started | 10m | Memory tools + meta-learning config |
| T027 | Update .gitignore | Not Started | 5m | Add context/ folder |
| T028 | Final integration testing | Not Started | 10m | Build, run, verify |

**Verification**: Clean build, schema generation works

---

## Summary

| Phase | Part | Tasks | Estimate |
|-------|------|-------|----------|
| 1. Memory Tools Foundation | A | T001-T005 | 2h |
| 2. Memory Tools Integration | A | T006-T010 | 2h |
| 3. Meta-Learning Agent | B | T011-T015 | 2h |
| 4. Pre-Compaction Hook | B | T016-T020 | 3h |
| 5. Commands & Review Workflow | B | T021-T023 | 2h |
| 6. Polish & Documentation | - | T024-T028 | 1h |
| **TOTAL** | | 28 tasks | ~12h |

## Dependencies

```
Phase 1 (Memory Tools Foundation)
    └── Phase 2 (Memory Tools Integration)
            └── Phase 3 (Meta-Learning Agent)
                    └── Phase 4 (Pre-Compaction Hook)
                            └── Phase 5 (Commands)
                                    └── Phase 6 (Docs)
```

---

## Key Technical Notes

### Primary Trigger: `experimental.session.compacting`

```typescript
// OpenCode provides this hook that fires BEFORE compaction
"experimental.session.compacting"?: (
  input: { sessionID: string }, 
  output: { context: string[] }
) => Promise<void>
```

This is the PRIMARY trigger - allows extraction before context is lost.

### Meta-Learning Categories

| Category | What It Improves | Example |
|----------|------------------|---------|
| **agent_instructions** | Agent prompts, roles, capabilities | "OmO should delegate frontend work earlier" |
| **commands** | Slash command behavior, workflows | "/implement should check for tasks.md first" |
| **orchestration** | Delegation patterns, agent selection | "Use explore agent for file discovery" |
| **context_handling** | Memory management, compaction | "Extract learnings before 70% context" |
| **tool_usage** | Tool selection, efficiency | "Use LSP instead of grep for symbols" |

---

## Notes

- Each phase is independently testable
- Phase 1-2 (Part A) must complete before Phase 3-5 (Part B)
- Update workflow state after each phase completion
- Use `bun run typecheck` after each task for verification
