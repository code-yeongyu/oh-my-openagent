# Port Workflow Specialists to OmO Plugin - Task Breakdown

**Linear Issue**: [LIF-72](https://linear.app/lifelogger/issue/LIF-72)
**Created**: 2025-12-22
**Total Estimate**: 14.8h

## Phase 1: Port Specialized Agents (4.5h)

**Goal**: Create 3 workflow specialist agents and enable research capability.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T1.0 | Enable `background_task: true` for specialist role | Not Started | 10min | `src/config/tool-config.ts` |
| T1.1 | Create product-strategist agent | Not Started | 75min | `src/agents/product-strategist.ts` |
| T1.2 | Create strategic-planner agent | Not Started | 75min | `src/agents/strategic-planner.ts` |
| T1.3 | Create task-planner agent | Not Started | 75min | `src/agents/task-planner.ts` |
| T1.4 | Update agents/index.ts exports | Not Started | 10min | `src/agents/index.ts` |
| T1.5 | Add agents to AGENT_ROLE_REGISTRY | Not Started | 5min | `src/agents/index.ts` |
| T1.6 | Add agent IDs to config schema | Not Started | 10min | `src/config/schema.ts` |
| T1.7 | Add agents to ALLOWED_AGENTS | Not Started | 5min | `src/tools/call-omo-agent/constants.ts` |
| T1.8 | Build and verify no TypeScript errors | Not Started | 10min | - |

**Checkpoint**: All 3 agents callable via `call_omo_agent("product-strategist")` etc.

### Agent Prompt Requirements (for T1.1-T1.3)

Each agent prompt MUST include:

1. **Role description**: What the agent does
2. **Research agents**: Which agents to use via `background_task`
   - product-strategist: `explore`, `librarian`
   - strategic-planner: `explore`, `librarian`, `oracle`
   - task-planner: `explore`
3. **Workflow state**: MUST call `update_workflow_state()` before completing
4. **Output format**: Structured JSON response
5. **Delegation restriction**: MUST NOT delegate work to other specialists

---

## Phase 2: Governance Enhancements (2h)

**Goal**: Create workflow enforcement hook and extend path validator.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T2.1 | Create workflow-state-enforcer hook | Not Started | 60min | `src/hooks/workflow-state-enforcer/` |
| T2.2 | Extend governance-path-validator for worktree conventions | Not Started | 30min | `src/hooks/governance-path-validator/` |
| T2.3 | Add validation logic to spec tools | Not Started | 20min | `src/tools/spec/tools.ts` |
| T2.4 | Update hooks/index.ts exports | Not Started | 5min | `src/hooks/index.ts` |
| T2.5 | Add hook config to schema | Not Started | 5min | `src/config/schema.ts` |

**Checkpoint**: Hooks warn when wrong agent attempts workflow step.

### Hook Implementation Details

**workflow-state-enforcer** (T2.1):
- Detect `/specify`, `/plan`, `/tasks` commands in session messages
- Check if correct specialist agent is being used
- Validate prerequisites (spec.md → plan.md → tasks.md)
- Mode: `warn` (default), `block`, `disabled`

**governance-path-validator extension** (T2.2):
- Add worktree path pattern validation
- Check: Uses issue ID, not full branch name
- Check: Located in `../{repo}-worktrees/` directory

---

## Phase 3: Update Commands (3h)

**Goal**: Update all workflow commands to use `call_omo_agent()`.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T3.1 | Update /specify command | Not Started | 30min | `.opencode/command/specify.md` |
| T3.2 | Update /plan command | Not Started | 30min | `.opencode/command/plan.md` |
| T3.3 | Update /tasks command | Not Started | 30min | `.opencode/command/tasks.md` |
| T3.4 | Update /implement command | Not Started | 20min | `.opencode/command/implement.md` |
| T3.5 | Update /review command | Not Started | 20min | `.opencode/command/review.md` |
| T3.6 | Update /test command | Not Started | 20min | `.opencode/command/test.md` |
| T3.7 | Update utility commands | Not Started | 30min | `/try-hard`, `/proceed`, `/clarify` |
| T3.8 | Fix worktree path to use issue ID | Not Started | 20min | `.opencode/command/specify.md` |

**Checkpoint**: All commands use `call_omo_agent()` instead of `.opencode/agent/` references.

### Command Update Pattern

Replace:
```markdown
Read `.opencode/agent/product-strategist.md` and adopt persona...
```

With:
```markdown
Delegate to product-strategist agent:
call_omo_agent(subagent_type="product-strategist", run_in_background=false, prompt="...")
```

---

## Phase 4: Documentation (3h)

**Goal**: Create visual documentation with mermaid flowcharts.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T4.1 | Create agent hierarchy diagram | Not Started | 45min | `docs/architecture/agent-hierarchy.md` |
| T4.2 | Create workflow orchestration diagram | Not Started | 45min | `docs/architecture/workflow-orchestration.md` |
| T4.3 | Create governance hooks diagram | Not Started | 45min | `docs/architecture/governance-hooks.md` |
| T4.4 | Create ADR-005-agent-porting | Completed | 45min | `docs/architecture/decisions/ADR-005-agent-porting.md` |

**Checkpoint**: All mermaid diagrams render correctly.

---

## Phase 5: Update Global Instructions (1.5h)

**Goal**: Update instruction files with new patterns.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T5.1 | Update governance.md | Not Started | 30min | `.opencode/instructions/governance.md` |
| T5.2 | Create workflow-patterns.md | Not Started | 30min | `.opencode/instructions/workflow-patterns.md` |
| T5.3 | Create agent-delegation.md | Not Started | 30min | `.opencode/instructions/agent-delegation.md` |

**Checkpoint**: Instructions reflect new agent delegation patterns.

---

## Phase 6: Archive Legacy Agents (30min)

**Goal**: Move legacy markdown agents to archive.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T6.1 | Create archive directory | Not Started | 5min | `.opencode/archive/legacy-agents/` |
| T6.2 | Move markdown agent files | Not Started | 15min | `.opencode/agent/*.md` → archive |
| T6.3 | Update any remaining references | Not Started | 10min | - |

**Checkpoint**: No `.opencode/agent/*.md` files remain (except README if any).

---

## Phase 7: Deploy to Global Config (20min)

**Goal**: Copy updated commands to global config.

| ID | Task | Status | Estimate | Files |
|----|------|--------|----------|-------|
| T7.1 | Copy commands to global config | Not Started | 10min | `~/.config/opencode/command/` |
| T7.2 | Verify commands load correctly | Not Started | 10min | - |

**Checkpoint**: Commands work from any project.

---

## Summary

| Phase | Tasks | Estimate | Status |
|-------|-------|----------|--------|
| Phase 1: Agents | 9 tasks | 4.5h | Not Started |
| Phase 2: Hooks | 5 tasks | 2h | Not Started |
| Phase 3: Commands | 8 tasks | 3h | Not Started |
| Phase 4: Docs | 4 tasks | 3h | Not Started |
| Phase 5: Instructions | 3 tasks | 1.5h | Not Started |
| Phase 6: Archive | 3 tasks | 0.5h | Not Started |
| Phase 7: Deploy | 2 tasks | 0.3h | Not Started |
| **Total** | **34 tasks** | **14.8h** | - |

## Recommended Execution Order

1. **T1.0** first (enables research for all specialists)
2. **T1.1-T1.7** then **T1.8** (create and verify agents)
3. Commit Phase 1
4. **T2.1-T2.5** (governance hooks)
5. Commit Phase 2
6. **T3.1-T3.8** (update commands)
7. Commit Phase 3
8. **T4.1-T4.4** (documentation)
9. Commit Phase 4
10. **T5.1-T5.3**, **T6.1-T6.3**, **T7.1-T7.2** (instructions, archive, deploy)
11. Final commit

## Notes

- Each phase should be committed separately
- Test each agent after creation (dogfooding)
- Keep legacy agents archived for rollback if needed
