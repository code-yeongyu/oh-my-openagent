# Global Governance Rules

> These rules apply to ALL agents in ALL conversations.

## Agent Architecture (LIF-72)

### TypeScript Plugin Agents (Primary)

Workflow specialist agents are now TypeScript agents in the oh-my-opencode plugin:

| Agent | Model | Purpose | Invoked Via |
|-------|-------|---------|-------------|
| `product-strategist` | Claude Sonnet 4.5 | Requirements & specs | `/specify` |
| `strategic-planner` | Claude Sonnet 4.5 | Architecture & plans | `/plan` |
| `task-planner` | Claude Sonnet 4.5 | Task breakdown | `/tasks` |
| `implementation-specialist` | Claude Sonnet 4.5 | Feature implementation | `/implement` |
| `test-specialist` | Claude Sonnet 4.5 | Testing | `/test` |
| `oracle` | GPT-5.2 | Code review, architecture | `/review` |

### Agent Delegation Pattern

Workflow commands delegate to agents via `call_omo_agent`:

```
call_omo_agent(
  subagent_type="product-strategist",
  run_in_background=false,
  prompt="TASK: Create feature specification..."
)
```

**Key Points**:
- Commands handle setup (Linear, worktree, spec folder)
- Agents focus on their specialty (spec writing, planning, etc.)
- Governance is automatic via hooks (no explicit agent calls)

### Governance Hooks (Automatic)

These hooks run automatically—agents don't need to call them:

| Hook | Event | Purpose |
|------|-------|---------|
| `governance-path-validator` | PreToolUse | Validates file paths |
| `governance-historian` | Stop | Creates changelog entries |
| `governance-linear-injector` | UserPromptSubmit | Injects Linear context |
| `workflow-state-enforcer` | UserPromptSubmit | Suggests correct agent |

### Archived Agent Locations

⚠️ **DEPRECATED** - These markdown agents are archived:
- `.opencode/agent/*.md` → Moved to `.opencode/archive/legacy-agents/`
- `.opencode/agent/context-steward.md` → Replaced by `governance-path-validator` hook
- `.opencode/agent/historian.md` → Replaced by `governance-historian` hook

### Agent Categories (Reference)

| Category | Plugin Agents | Purpose |
|----------|---------------|---------|
| **Workflow** | product-strategist, strategic-planner, task-planner | Spec → Plan → Tasks |
| **Implementation** | implementation-specialist, backend-*, frontend-* | Code changes |
| **Quality** | test-specialist, oracle | Testing, review |
| **Research** | explore, librarian | Codebase/docs research |
| **Utility** | multimodal-looker, document-writer | Media, docs |

## Linear Integration (Mandatory)

### Before Starting Work

1. **Verify Linear Issue Exists**
   - All significant work (>30 min) must have a Linear issue
   - If no issue exists, create one before proceeding
   - Use branch name from Linear for all git operations

2. **Check Issue Context**
   - Read issue description for requirements
   - Check related issues and parent epics
   - Note acceptance criteria

### During Work

1. **Reference Linear Issue**
   - Include issue ID in all commits: `feat(scope): description [ABC-123]`
   - Link PRs to Linear issues
   - Post progress updates as comments (for long tasks)

### After Completing Work

1. **Update Linear Issue**
   - Change status (In Progress → In Review → Done)
   - Add completion summary as comment
   - Link any created PRs or documentation

## Git Commit Standards

### Commit Format

```
type(scope): description [LINEAR-ID]

- Detail 1
- Detail 2

Refs: LINEAR-ID
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation
- `refactor`: Code refactoring
- `test`: Test additions/changes
- `chore`: Maintenance tasks

### Scope
- Use feature/component name
- Keep consistent with Linear issue scope

## Documentation Standards

### What Goes Where

| Content | Location |
|---------|----------|
| Architecture specs | Mintlify `docs/architecture/` |
| API documentation | Mintlify `docs/api-reference/` |
| Feature specs | Mintlify `docs/features/` |
| User guides | Mintlify `docs/guides/` |
| ADRs | `docs/decisions/` (repo) + Mintlify |
| Quick notes | Directory `AGENTS.md` files |
| Task context | Linear issue description/comments |

### Documentation Triggers

- New feature → Create feature spec in Mintlify
- Architecture change → Create/update ADR
- API change → Update API docs
- Complex decision → Document in Linear issue + ADR

## Audit Trail Requirements

1. **All significant work must be traceable**
   - Linear issue → Git commits → PR → Documentation

2. **Historian agent is called after**:
   - Feature implementation
   - Bug fixes
   - Architecture changes
   - Documentation updates
   - Configuration changes

3. **Skip audit trail only for**:
   - Typo fixes
   - Comment additions
    - Formatting changes

## Agent Scope Enforcement
- linear-coordinator: Linear ops ONLY. RETURN results to orchestrator. No task() delegation.

ALWAYS verify file/dir existence before assumptions—use list(path), glob('**/*'), read(filePath). Examples: Before analysis/delegation, batch list('/Users/eru/Documents/GitHub/project-template/.opencode'), glob('.opencode/**'); read('/Users/eru/Documents/GitHub/project-template/.opencode/project-context.yaml') if assuming missing.

