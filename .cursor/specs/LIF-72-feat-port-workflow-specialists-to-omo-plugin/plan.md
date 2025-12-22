# Port Workflow Specialists to OmO Plugin - Implementation Plan

**Linear Issue**: [LIF-72](https://linear.app/lifelogger/issue/LIF-72)
**Created**: 2025-12-22
**Author**: Strategic Architect (OmO)

## Summary

Port 3 workflow-specific agents from legacy `.opencode/agent/*.md` markdown files to OmO plugin TypeScript agents. Create 2 governance enhancements (1 new hook + 1 extension) to enforce proper delegation patterns. Update 6+ workflow commands to use `call_omo_agent()` instead of markdown persona adoption.

> **Revision Note (2025-12-22)**: Plan updated based on code review findings - added ALLOWED_AGENTS step, consolidated hooks 4→2, adjusted time estimates to 75min/agent.

## Technical Context

| Aspect | Details |
|--------|---------|
| **Language** | TypeScript 5.7+ |
| **Runtime** | Bun >= 1.0.0 |
| **Framework** | @opencode-ai/plugin SDK |
| **Target Files** | `src/agents/*.ts`, `src/hooks/governance-*/*.ts` |
| **Commands** | `.opencode/command/*.md` |

## Constitution Check

| Principle | Compliance |
|-----------|------------|
| I. Plugin-First Architecture | ✅ All agents use `@opencode-ai/sdk` AgentConfig |
| II. Multi-Model Excellence | ✅ Using Claude Sonnet for workflow specialists |
| III. Multi-Layered Orchestration | ✅ New agents are "specialist" role (terminal nodes) |
| IV. Bun-Native Development | ✅ All tooling uses Bun |
| V. Hook-Driven Enhancement | ✅ New governance hooks follow existing patterns |
| VI. Dogfooding | ✅ Commands use our own agent system |
| VII. GitHub Actions Publishing | ✅ No changes to publishing |

## Architecture

### Agent Hierarchy (Updated)

```
OmO (Team Lead - Claude Opus)
├── implementation-specialist (Manager - Gemini Flash)
│   ├── Language Specialists (backend-typescript, backend-rust, backend-python)
│   ├── Frontend Specialists (frontend-react, frontend-ui-ux-engineer)
│   └── ... (existing specialists)
├── product-strategist (Specialist - Claude Sonnet) ← NEW
├── strategic-planner (Specialist - Claude Sonnet) ← NEW
├── task-planner (Specialist - Claude Sonnet) ← NEW
├── oracle (Advisor - GPT-5.2) - read-only
├── librarian (Utility - Claude Sonnet) - read-only
└── explore (Utility - Grok) - read-only
```

### Workflow Command → Agent Mapping

| Command | Current | Target Agent |
|---------|---------|--------------|
| `/specify` | Reads `.opencode/agent/product-strategist.md` | `call_omo_agent("product-strategist")` |
| `/plan` | Reads `.opencode/agent/strategic-architect.md` | `call_omo_agent("strategic-planner")` |
| `/tasks` | Manual task creation | `call_omo_agent("task-planner")` |
| `/implement` | Uses implementation-specialist | No change needed |
| `/review` | Direct execution | Could use code-reviewer agent (future) |
| `/test` | Direct execution | Could use test-specialist agent (future) |

### Governance Hook Flow (Consolidated)

```
User invokes /specify
    ↓
workflow-state-enforcer hook (NEW)
    → Checks: Is this the right time for /specify?
    → Suggests: Use product-strategist if wrong agent
    → Warns if prerequisites missing
    ↓
governance-path-validator hook (EXTENDED)
    → Validates: Is worktree path using issue ID?
    → Validates: Standard path conventions
    ↓
Command delegates to product-strategist
    ↓
Agent completes work
    → Agent MUST call update_workflow_state() before returning
    → Validation logic built into spec tools
```

**Design Decision**: Consolidated from 4 hooks to 2 for reduced complexity:
- `workflow-state-enforcer` = workflow-delegation + workflow-sequence
- Extended `governance-path-validator` = worktree conventions
- Removed `governance-spec-operations` = moved validation to `src/tools/spec/`

## Data Models

### Agent Config Structure

```typescript
// src/agents/product-strategist.ts
export const productStrategistAgent: AgentConfig = {
  description: "Spec writing specialist for /specify command",
  mode: "subagent",
  model: "anthropic/claude-sonnet-4-5",
  tools: {
    // Specialist: Cannot delegate
    task: false,
    background_task: false,
    call_omo_agent: false,
    // File tools: enabled for spec writing
    write: true,
    edit: true,
    read: true,
    // Spec tools
    create_spec_folder: true,
    update_workflow_state: true,
    // Linear tools
    linear_branch: true,
    linear_update_status: true,
  },
  prompt: `<role>...</role>`,
}
```

### Role Registry Update

```typescript
// src/agents/index.ts - AGENT_ROLE_REGISTRY additions
export const AGENT_ROLE_REGISTRY: Record<string, AgentRole> = {
  // ... existing entries
  
  // LIF-72: Workflow Specialists
  "product-strategist": "specialist",
  "strategic-planner": "specialist", 
  "task-planner": "specialist",
}
```

### Governance Hook Config (Consolidated)

```typescript
// src/hooks/workflow-state-enforcer/types.ts
export interface WorkflowStateEnforcerConfig {
  enabled: boolean
  mode: "warn" | "block" | "disabled"
  // Command → required agent mapping
  workflow_agents: Record<string, string>
  // Command → prerequisite steps
  prerequisites: Record<string, string[]>
}

export const DEFAULT_WORKFLOW_STATE_ENFORCER_CONFIG: WorkflowStateEnforcerConfig = {
  enabled: true,
  mode: "warn", // Default to warn, not block
  workflow_agents: {
    "/specify": "product-strategist",
    "/plan": "strategic-planner",
    "/tasks": "task-planner",
  },
  prerequisites: {
    "/plan": ["spec.md"],      // Requires spec.md exists
    "/tasks": ["plan.md"],     // Requires plan.md exists
    "/implement": ["tasks.md"], // Requires tasks.md exists
  },
}
```

### Agent State Management

```typescript
// Each workflow agent MUST call update_workflow_state() before returning
// This is enforced via agent prompt, not orchestrator wrapping

// Agent prompt template includes:
// "MANDATORY: Before completing, call update_workflow_state() with:
//   - specPath: the spec folder path
//   - step: 'specify' | 'plan' | 'tasks' | etc.
//   - linearStatus: 'in_progress' or 'in_review'"
```

## Implementation Steps

### Phase 1: Port Specialized Agents (4h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 1.1 | Create product-strategist.ts | `src/agents/product-strategist.ts` | 75min |
| 1.2 | Create strategic-planner.ts | `src/agents/strategic-planner.ts` | 75min |
| 1.3 | Create task-planner.ts | `src/agents/task-planner.ts` | 75min |
| 1.4 | Update index.ts exports | `src/agents/index.ts` | 10min |
| 1.5 | Add to AGENT_ROLE_REGISTRY | `src/agents/index.ts` | 5min |
| 1.6 | Update config schema | `src/config/schema.ts` | 10min |
| 1.7 | **Add to ALLOWED_AGENTS** | `src/tools/call-omo-agent/constants.ts` | 5min |

> **Critical**: Step 1.7 is REQUIRED. Without adding agents to `ALLOWED_AGENTS`, `call_omo_agent()` calls will fail at runtime.

**Agent Prompt Sources**:
- product-strategist: Port from existing spec writing patterns
- strategic-planner: Port from implementation-specialist decomposition + oracle patterns
- task-planner: Create new based on Linear integration patterns

**Agent Prompt Requirements** (all agents must include):
- MUST call `update_workflow_state()` before completing
- MUST return structured JSON response
- MUST NOT delegate to other agents (specialist role)

### Phase 2: Governance Enhancements (2h)

> **Consolidated**: Reduced from 4 hooks to 2 enhancements based on code review.

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 2.1 | Create workflow-state-enforcer | `src/hooks/workflow-state-enforcer/` | 60min |
| 2.2 | Extend governance-path-validator | `src/hooks/governance-path-validator/` | 30min |
| 2.3 | Add validation to spec tools | `src/tools/spec/tools.ts` | 20min |
| 2.4 | Update hooks/index.ts exports | `src/hooks/index.ts` | 5min |
| 2.5 | Update config schema | `src/config/schema.ts` | 5min |

**Consolidation Rationale**:
- `workflow-state-enforcer` = combines workflow-delegation + workflow-sequence
- Extended `governance-path-validator` = adds worktree convention validation
- Removed `governance-spec-operations` = validation moved to `src/tools/spec/tools.ts`

**Hook Patterns**:
- Follow `governance-path-validator` structure (index.ts, types.ts)
- Use `tool.execute.before` for pre-execution validation
- Use `session.message` for command detection
- Default to "warn" mode, not "block"

### Phase 3: Update Commands (3h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 3.1 | Update /specify command | `.opencode/command/specify.md` | 30min |
| 3.2 | Update /plan command | `.opencode/command/plan.md` | 30min |
| 3.3 | Update /tasks command | `.opencode/command/tasks.md` | 30min |
| 3.4 | Update /implement command | `.opencode/command/implement.md` | 20min |
| 3.5 | Update /review command | `.opencode/command/review.md` | 20min |
| 3.6 | Update /test command | `.opencode/command/test.md` | 20min |
| 3.7 | Update utility commands | `/try-hard`, `/proceed`, `/clarify` | 30min |
| 3.8 | Fix worktree path in /specify | Use issue ID, not full branch | 20min |

**Command Updates**:
- Replace "read `.opencode/agent/X.md`" with `call_omo_agent("X")`
- Keep detailed step instructions (reinforcement)
- Keep tool usage examples
- Add "Delegate to X agent" sections

### Phase 4: Documentation (3h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 4.1 | Agent hierarchy mermaid | `docs/architecture/agent-hierarchy.md` | 45min |
| 4.2 | Workflow orchestration mermaid | `docs/architecture/workflow-orchestration.md` | 45min |
| 4.3 | Governance hooks mermaid | `docs/architecture/governance-hooks.md` | 45min |
| 4.4 | ADR-005-agent-porting | `docs/architecture/decisions/ADR-005-agent-porting.md` | 45min |

### Phase 5: Update Global Instructions (1.5h)

| Step | Task | Files | Estimate |
|------|------|-------|----------|
| 5.1 | Update governance.md | `.opencode/instructions/governance.md` | 30min |
| 5.2 | Create workflow-patterns.md | `.opencode/instructions/workflow-patterns.md` | 30min |
| 5.3 | Create agent-delegation.md | `.opencode/instructions/agent-delegation.md` | 30min |

### Phase 6: Archive Legacy Agents (30min)

| Step | Task | Estimate |
|------|------|----------|
| 6.1 | Create archive directory | 5min |
| 6.2 | Move markdown agents | 15min |
| 6.3 | Update references | 10min |

### Phase 7: Deploy to Global Config (20min)

| Step | Task | Estimate |
|------|------|----------|
| 7.1 | Copy commands to ~/.config/opencode/command/ | 10min |
| 7.2 | Verify commands load | 10min |

## Dependencies

### Internal (This Repo)

| Dependency | Status | Notes |
|------------|--------|-------|
| `src/agents/index.ts` | Exists | Add new agent exports |
| `src/hooks/index.ts` | Exists | Add new hook exports |
| `src/config/schema.ts` | Exists | Add new config options |
| `src/tools/spec/` | Exists | Uses create_spec_folder, update_workflow_state |
| `src/tools/call-omo-agent/constants.ts` | Exists | **CRITICAL**: Add to ALLOWED_AGENTS |

### External

| Dependency | Status | Notes |
|------------|--------|-------|
| Linear MCP | Required | For task-planner Linear operations |
| @opencode-ai/plugin | Required | Core SDK |
| @opencode-ai/sdk | Required | Agent types |

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing workflows | Medium | High | Test each command, keep legacy archived |
| Governance hooks too aggressive | Low | Medium | Default to warn mode |
| Agent prompt quality regression | Low | High | Port prompts carefully, test each agent |
| Context window issues | Low | Medium | Keep prompts focused and concise |

## Testing Strategy

Since no test framework exists, testing is via dogfooding:

1. **Per-Agent Testing**: Invoke each new agent via `call_omo_agent()` and verify behavior
2. **Command Testing**: Run each updated command on a test feature
3. **Hook Testing**: Trigger each governance hook condition and verify warnings
4. **Integration Testing**: Complete full workflow (/specify → /plan → /tasks → /implement)

## Success Metrics

| Metric | Target |
|--------|--------|
| New agents callable via `call_omo_agent()` | 3/3 |
| Agents in ALLOWED_AGENTS | 3/3 |
| Governance enhancements functional | 2/2 (1 new hook + 1 extension) |
| Commands updated | 6+/6+ |
| Mermaid docs created | 3/3 |
| Legacy agents archived | 100% |
| No broken workflows | 0 failures |

## Time Summary

| Phase | Original | Revised | Delta |
|-------|----------|---------|-------|
| Phase 1: Agents | 2.5h | 4h | +1.5h (75min/agent + testing) |
| Phase 2: Hooks | 3h | 2h | -1h (consolidated) |
| Phase 3: Commands | 3h | 3h | - |
| Phase 4: Docs | 3h | 3h | - |
| Phase 5: Instructions | 1.5h | 1.5h | - |
| Phase 6: Archive | 0.5h | 0.5h | - |
| Phase 7: Deploy | 0.3h | 0.3h | - |
| **Total** | **13.8h** | **14.3h** | **+0.5h** |

## Next Steps

After plan approval:
1. Run `/tasks` to create Linear sub-issues
2. Run `/implement` to start Phase 1 (create agents)
3. Commit after each phase completion
