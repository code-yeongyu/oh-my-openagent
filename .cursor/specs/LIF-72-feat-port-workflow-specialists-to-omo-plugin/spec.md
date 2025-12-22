# Port Workflow Specialists to OmO Plugin

**Linear Issue**: [LIF-72](https://linear.app/lifelogger/issue/LIF-72/port-workflow-specialists-to-omo-plugin-and-update-commands)
**Created**: 2025-12-22
**Status**: Ready for Planning

## Overview

Port specialized workflow agents from legacy `.opencode/agent/*.md` markdown files to the OmO plugin TypeScript agent system. This enables proper integration with OmO's multi-layered orchestration, distributes cognitive load across specialized agents, and ensures workflow commands use the correct specialists for each step.

Additionally, create governance hooks to enforce proper agent delegation patterns, and comprehensive documentation with mermaid flowcharts showing agent hierarchy and workflow orchestration.

## Problem Statement

### Current State
- Workflow commands (`/specify`, `/plan`, `/tasks`, etc.) reference `.opencode/agent/*.md` markdown files
- These markdown agents are NOT integrated with the OmO plugin system
- Commands instruct agents to "read and adopt persona" from markdown files
- Governance calls (context-steward, historian) are manual and inconsistent
- No enforcement of which agent handles which workflow step

### Issues
1. **Two systems to maintain**: OmO TypeScript agents vs legacy markdown agents
2. **Context window bloat**: OmO tries to handle all workflow steps itself
3. **Inconsistent governance**: Manual calls to context-steward/historian often skipped
4. **No enforcement**: Wrong agents can attempt workflow-specific tasks
5. **Missing documentation**: No visual representation of agent hierarchy

## User Stories

### US-1: As a developer using /specify
I want the command to automatically delegate to a specialized product-strategist agent
So that I get focused, high-quality spec writing without OmO's context becoming bloated

**Acceptance Criteria:**
- `/specify` delegates to `product-strategist` agent for spec writing
- Governance hook warns if OmO tries to write spec.md directly
- Spec quality is maintained or improved

### US-2: As a developer using /plan
I want the command to delegate to a strategic-planner with oracle consultation
So that I get architecture decisions informed by specialized expertise

**Acceptance Criteria:**
- `/plan` delegates to `strategic-planner` agent
- `oracle` is consulted for architecture review
- Plan includes proper technical context

### US-3: As a developer using /tasks
I want the command to delegate to a task-planner specialist
So that I get proper phase-based task decomposition

**Acceptance Criteria:**
- `/tasks` delegates to `task-planner` agent
- Tasks are organized by phases (Setup, Foundational, User Stories, Polish)
- Linear tools are used directly (no coordinator layer)

### US-4: As a maintainer of the OmO plugin
I want governance hooks that enforce proper agent delegation
So that workflow patterns are consistent and errors are caught early

**Acceptance Criteria:**
- `governance-workflow-delegation` hook suggests correct specialist
- `governance-spec-operations` hook validates tool usage
- `governance-worktree-conventions` hook enforces naming
- `governance-workflow-sequence` hook blocks out-of-order steps

### US-5: As a new contributor to the project
I want visual documentation of agent hierarchy and workflows
So that I can understand how OmO orchestration works

**Acceptance Criteria:**
- Mermaid flowcharts show agent hierarchy
- Documentation explains workflow command flow
- Governance hook behaviors are documented

## Requirements

### Functional Requirements

#### FR-1: New OmO Plugin Agents
1. **product-strategist.ts**: Spec writing expertise for `/specify`
   - Focus on requirements, user stories, acceptance criteria
   - Technology-agnostic output
   - Specialist role (cannot delegate)

2. **strategic-planner.ts**: Architecture planning for `/plan`
   - Technical context analysis
   - Constitution check integration
   - Consults oracle for review
   - Specialist role (cannot delegate)

3. **task-planner.ts**: Task decomposition for `/tasks`
   - Phase-based organization (Setup → Foundational → User Stories → Polish)
   - Uses Linear tools directly
   - Specialist role (cannot delegate)

#### FR-2: Governance Hooks
1. **governance-workflow-delegation**: Detects workflow commands, suggests correct specialist if wrong agent attempts work
2. **governance-spec-operations**: Validates spec folder tool usage, reminds about workflow state
3. **governance-worktree-conventions**: Validates worktree path uses issue ID (not full branch), correct base branch (`dev`)
4. **governance-workflow-sequence**: Blocks workflow commands if prerequisites missing

#### FR-3: Updated Commands
1. All workflow commands updated to use `call_omo_agent(subagent_type: "...")` pattern
2. Remove all `.opencode/agent/` references
3. Keep detailed steps with tool usage instructions
4. Keep reinforcement reminders for reliability

#### FR-4: Documentation
1. Mermaid flowcharts for agent hierarchy, workflow commands, governance hooks
2. Markdown documentation explaining orchestration patterns
3. ADR documenting the agent porting decision

### Non-Functional Requirements

#### NFR-1: Maintainability
- Single source of truth for agent logic (TypeScript only)
- Clear separation: commands define workflow, agents execute work

#### NFR-2: Reliability
- Governance hooks catch common mistakes
- Commands include reinforcement reminders
- Workflow sequence enforced

#### NFR-3: Performance
- Specialized agents reduce OmO context window usage
- Each workflow step gets fresh agent context

## Scope

### In Scope

#### Phase 1: Port Specialized Agents (~2.5h)
- Create `src/agents/product-strategist.ts`
- Create `src/agents/strategic-planner.ts`
- Create `src/agents/task-planner.ts`
- Update `src/agents/index.ts` and types

#### Phase 2: Create Governance Hooks (~3h)
- Create `src/hooks/governance-workflow-delegation/`
- Create `src/hooks/governance-spec-operations/`
- Create `src/hooks/governance-worktree-conventions/`
- Enhance `src/hooks/governance-workflow-sequence/` or create new
- Update hook exports and config schema

#### Phase 3: Update Commands (~3h)
- Update `/specify`, `/plan`, `/tasks`, `/implement`, `/review`, `/test`
- Update utility commands (`/try-hard`, `/proceed`, `/clarify`, etc.)
- Remove all `.opencode/agent/` references
- Add `call_omo_agent` delegation patterns

#### Phase 4: Documentation (~3h)
- Create mermaid flowcharts (agent hierarchy, workflow, hooks)
- Write `docs/architecture/omo-agent-hierarchy.md`
- Write `docs/architecture/workflow-orchestration.md`
- Write `docs/architecture/governance-hooks.md`
- Create ADR-005-agent-porting.md

#### Phase 5: Update Global Instructions (~1.5h)
- Update `.opencode/instructions/governance.md`
- Create `.opencode/instructions/workflow-patterns.md`
- Create `.opencode/instructions/agent-delegation.md`
- Create `.opencode/instructions/hook-behaviors.md`

#### Phase 6: Archive Legacy Agents (~30min)
- Move `.opencode/agent/*.md` to `.opencode/archive/legacy-agents/`
- Update any remaining references

#### Phase 7: Deploy to Global Config (~20min)
- Copy updated commands to `~/.config/opencode/command/`
- Verify commands load correctly

### Out of Scope
- Creating a `linear-coordinator` agent (Linear tools work well with direct usage)
- Modifying existing OmO plugin agents (oracle, implementation-specialist, etc.)
- Changes to OmO's core orchestration logic
- UI/frontend changes

## Assumptions

1. **Linear tools work well directly**: No need for a coordinator layer; agents use Linear tools directly
2. **Specialist role is appropriate**: New agents should not delegate (terminal nodes in hierarchy)
3. **Claude Sonnet is appropriate model**: For workflow specialists, Sonnet provides good balance
4. **Governance hooks are opt-in friendly**: Hooks warn/suggest, don't hard-block by default
5. **Worktree workflow is adopted**: Commands assume worktree-based development
6. **Issue ID for worktree paths**: Worktree folders use issue ID only (e.g., `lif-72-...`), not full branch name with username prefix (see DD-1)

## Dependencies

### Technical Dependencies
- OmO plugin agent system (`src/agents/`)
- Hook system (`src/hooks/`)
- Command loader (`src/features/claude-code-command-loader/`)
- Existing governance hooks as patterns

### External Dependencies
- Linear MCP for issue management
- Git worktrees feature

## Success Criteria

1. **Agent Integration**: All 3 new agents (product-strategist, strategic-planner, task-planner) are registered in OmO plugin and callable via `call_omo_agent`

2. **Command Updates**: All workflow commands (`/specify`, `/plan`, `/tasks`, `/implement`, `/review`, `/test`) reference OmO plugin agents instead of `.opencode/agent/` files

3. **Governance Enforcement**: Hooks detect and warn when wrong agents attempt workflow-specific tasks

4. **Documentation Complete**: Mermaid flowcharts and markdown docs exist in `docs/architecture/`

5. **Legacy Archived**: All `.opencode/agent/*.md` files moved to archive

6. **Global Deployment**: Updated commands available in `~/.config/opencode/command/`

## Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Breaking existing workflows | Medium | High | Test each command after update, keep legacy archived for rollback |
| Governance hooks too aggressive | Low | Medium | Default to warn mode, not block mode |
| Agent prompt quality regression | Low | High | Port prompts carefully from existing markdown agents |
| Context window issues with new agents | Low | Medium | Keep specialist prompts focused and concise |

## Design Decisions

### DD-1: Worktree Path Convention (Option B)

**Decision**: Use issue ID only for worktree folder names, not full branch name.

**Context**: Linear branch names include username prefix (e.g., `hello/lif-72-...`), which creates nested subdirectories when used as folder paths.

**Options Considered**:
- **Option A**: Use full branch name → `../repo-worktrees/hello/lif-72-...` (nested)
- **Option B**: Use issue ID only → `../repo-worktrees/lif-72-...` (flat, cleaner) ✅

**Rationale**:
- Cleaner folder structure (flat, not nested by username)
- Issue ID is unique and meaningful
- Full branch name still used for git operations
- Simpler path handling in `create_spec_folder` tool

**Implementation**:
- `/specify` command extracts issue ID from branch name
- Worktree path: `../{REPO_NAME}-worktrees/{ISSUE_ID}-{slug}`
- Example: `../oh-my-opencode-worktrees/lif-72-port-workflow-specialists`
- Git branch remains: `hello/lif-72-port-workflow-specialists-to-omo-plugin-and-update-commands`

### DD-2: Specialist Agent Role

**Decision**: New workflow agents are "specialist" role (cannot delegate).

**Rationale**:
- Terminal nodes in agent hierarchy
- Each handles one workflow step completely
- Reduces complexity and potential delegation loops
- Matches existing pattern (frontend-ui-ux-engineer, document-writer)

### DD-3: Governance Hook Behavior

**Decision**: Hooks warn/suggest by default, don't hard-block.

**Rationale**:
- Avoid breaking workflows during transition
- Guide correct behavior gradually
- Can escalate to blocking after patterns stabilize

## Open Questions

None - all questions resolved during planning discussion.
