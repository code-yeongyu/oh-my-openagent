# LIF-57: Enhance Oh-My-OpenCode with Orchestration Learnings

**Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
**Status**: In Progress
**Priority**: High

---

## Executive Summary

This spec defines how to **enhance oh-my-opencode (OmO)** with the best practices, governance patterns, and agent orchestration learnings from our `.opencode/` system. The goal is NOT migration, but **synthesis** - creating a superior agentic automation platform that combines:

- **OmO's strengths**: Background tasks, LSP/AST tools, multi-model agents, hook system
- **Our strengths**: Governance-first workflow, Linear integration, spec-driven development, audit trails

---

## System Comparison: Deep Analysis

### 1. Orchestrator Philosophy

| Aspect | OmO | Our Orchestrator | Analysis |
|--------|-----|------------------|----------|
| **Role** | Team Lead - works AND delegates | Railway Conductor - ONLY delegates | OmO is more flexible; ours enforces separation of concerns |
| **Execution** | Can write code directly | Cannot write/edit/bash | Ours prevents orchestrator scope creep |
| **Planning** | Todo-obsessive (2+ steps = todos) | Todo + structured plans | Similar, but ours has governance todos |
| **Thinking** | Extended thinking (32k budget) | Standard | OmO has deeper reasoning capability |
| **Model** | claude-opus-4-5 | claude-opus-4-5 | Same |

**Verdict**: Hybrid approach - OmO's flexibility with our governance guardrails.

### 2. Agent Ecosystem

#### OmO Built-in Agents (7)

| Agent | Model | Purpose | Equivalent in Ours |
|-------|-------|---------|-------------------|
| **OmO** | claude-opus-4-5 | Primary orchestrator | orchestrator |
| **Oracle** | gpt-5.2 | Architecture, code review | strategic-architect + code-reviewer |
| **Explore** | grok-code | Fast codebase exploration | project-guru |
| **Librarian** | claude-sonnet-4-5 | External docs, GitHub research | research |
| **Frontend-UI-UX-Engineer** | gemini-3-pro | UI/UX development | web-design-guru |
| **Document-Writer** | gemini-3-pro | Technical writing | documentation-master |
| **Multimodal-Looker** | gemini-2.5-flash | PDF/image analysis | (none - NEW capability) |

#### Our Agents (25)

**Governance (unique to us)**:
- `context-steward` - Path validation, structure enforcement
- `historian` - Audit trail, changelog discipline
- `agent-auditor` - Agent health checks
- `meta-improvement-analyst` - Pattern analysis

**Planning**:
- `product-strategist` - Requirements, user stories
- `strategic-architect` - System design, ADRs
- `linear-coordinator` - Linear integration (unique)

**Implementation**:
- `implementation-specialist` - Production code
- `quick-fixer` - Hotfixes, urgent bugs
- `devops-specialist` - Infrastructure, CI/CD

**Quality**:
- `code-reviewer` - Technical reviews
- `test-engineer` - Test suites
- `documentation-master` - API docs

**Specialized**:
- `rag-architect`, `ml-engineer`, `ai-engineer-agentic` - AI/ML
- `web-design-guru` - UI/UX
- `project-guru` - Codebase explanations
- `brd-creator` - Official BRDs
- `rule-engineer`, `agent-engineer` - Meta/system

**Verdict**: Our agent ecosystem is 3.5x larger with specialized governance agents OmO lacks.

### 3. Governance Systems

| Feature | OmO | Ours | Gap |
|---------|-----|------|-----|
| **Path Validation** | None | Context Steward enforces `context/specs/` | OmO needs this |
| **Audit Trail** | None | Historian creates changelogs | OmO needs this |
| **Linear Integration** | None | Deep integration (issues, branches, status) | OmO needs this |
| **Spec-Driven Workflow** | None | Full lifecycle in `context/specs/{ID}/` | OmO needs this |
| **Constitution** | None | `context/memory/constitution.md` | OmO needs this |
| **Changelog Discipline** | None | 5-10 line entries per agent | OmO needs this |

**Verdict**: OmO has ZERO governance. This is our biggest contribution.

### 4. Tool Systems

#### OmO Tools (22+)

**LSP Tools (11)** - UNIQUE to OmO:
- `lsp_hover`, `lsp_goto_definition`, `lsp_find_references`
- `lsp_rename`, `lsp_diagnostics`, `lsp_code_actions`
- `lsp_document_symbols`, `lsp_workspace_symbols`
- `lsp_completion`, `lsp_signature_help`, `lsp_formatting`

**AST-grep Tools (2)** - UNIQUE to OmO:
- `ast_grep_search` - Structural code search
- `ast_grep_replace` - Structural code replacement

**Background Tools (3)** - UNIQUE to OmO:
- `background_task` - Fire-and-forget agent execution
- `background_output` - Collect background results
- `background_cancel` - Cancel background tasks

**Agent Tools (2)**:
- `call_omo_agent` - Direct agent invocation
- `look_at` - Multimodal file analysis

**Utility Tools**:
- `grep`, `glob`, `slashcommand`, `skill`, `interactive_bash`

#### Our Custom Tools (5)

- `linear-branch` - Get branch name for Linear issue
- `linear-update-status` - Update Linear issue status
- `mintlify-sync` - Documentation sync
- `read-context` - Read project context
- `init-project` - Project initialization

**Verdict**: OmO has superior code intelligence tools (LSP, AST). We have superior project management tools (Linear).

### 5. Hook Systems

#### OmO Hooks (20+)

**Session Management**:
- `session-recovery` - Recovers from 4 error types
- `session-notification` - Session start/end notifications
- `context-window-monitor` - Warns at 70% token usage
- `anthropic-auto-compact` - Auto-compacts context

**Todo Enforcement**:
- `todo-continuation-enforcer` - Forces completion of incomplete todos

**Context Injection**:
- `rules-injector` - Injects rules from `.claude/rules/`
- `directory-agents-injector` - Injects AGENTS.md context
- `directory-readme-injector` - Injects README context

**Code Quality**:
- `comment-checker` - Validates code comments
- `keyword-detector` - Detects sensitive keywords

**Tool Enhancement**:
- `grep-output-truncator` - Truncates large grep output
- `tool-output-truncator` - Truncates tool output
- `interactive-bash-session` - Interactive bash support

**Agent Guidance**:
- `agent-usage-reminder` - Reminds about agent capabilities
- `empty-task-response-detector` - Detects empty responses
- `think-mode` - Enables extended thinking

**External**:
- `claude-code-hooks` - Claude Code compatibility layer
- `auto-update-checker` - Plugin update notifications
- `background-notification` - Background task notifications
- `non-interactive-env` - Non-interactive environment handling

#### Our Hooks

We don't have a hook system - governance is enforced through agent instructions.

**Verdict**: OmO's hook system is powerful. We should leverage it for governance enforcement.

### 6. Configuration Systems

| Feature | OmO | Ours |
|---------|-----|------|
| **Config File** | `oh-my-opencode.json` | `project-context.yaml` |
| **Schema** | Zod-validated | YAML (no validation) |
| **Agent Overrides** | Yes (model, temp, permissions) | No |
| **Hook Disabling** | Yes | N/A |
| **Two-tier Config** | User + Project | Project only |

**Verdict**: OmO's config system is more sophisticated.

### 7. Workflow Patterns

#### OmO Workflows

```
Intent Gate → Search Strategy → Implementation/Exploration → Verification
```

- Intent classification on EVERY message
- Search scope assessment before agents
- Direct tools first (grep/glob/LSP)
- Background task parallelism

#### Our Workflows

```
Analyze → Plan → Engage Agents → Governance → Report
```

- Structured workflow patterns (NEW_FEATURE, BUG_FIX, etc.)
- Governance checkpoints (Context Steward, Historian)
- Linear issue lifecycle
- Spec-driven development

**Verdict**: Both have strong workflows. OmO is more adaptive; ours is more structured.

---

## Unique Value We Bring to OmO

### 1. Governance System (CRITICAL)

**What OmO Lacks**:
- No path validation → files created anywhere
- No audit trail → no history of what was done
- No Linear integration → no issue tracking
- No spec-driven workflow → no structured planning

**What We Add**:
```
Context Steward → Path validation before file creation
Historian → Changelog after every agent
Linear Coordinator → Issue lifecycle management
Spec-Driven Workflow → context/specs/{ID}/ structure
```

### 2. Specialized Agents (18 unique)

OmO has 7 agents. We have 25. These 18 are unique:

**Governance**: context-steward, historian, agent-auditor, meta-improvement-analyst
**Planning**: product-strategist, linear-coordinator
**Implementation**: implementation-specialist, quick-fixer, devops-specialist
**Quality**: test-engineer
**Specialized**: rag-architect, ml-engineer, ai-engineer-agentic, brd-creator, rule-engineer, agent-engineer, conversation-auditor, chat-auditor

### 3. Linear Integration

**Full Lifecycle**:
- Issue creation with templates
- Branch naming from Linear
- Status updates (In Progress → In Review → Done)
- Comment posting with summaries
- Spec folder naming: `{ISSUE-ID}-{type}-{name}`

### 4. Spec-Driven Development

**Structure**:
```
context/specs/{ISSUE-ID}-{type}-{name}/
├── spec.md              # Requirements
├── plan.md              # Architecture
├── tasks.md             # Task breakdown
├── status.md            # Status tracking
├── implementation/      # Implementation notes
├── reviews/             # Code reviews
├── testing/             # Test plans
├── linear/              # Linear issues (local-first)
└── changelog/           # Audit trail
```

### 5. Changelog Discipline

**Format**:
```markdown
# Changelog Entry - YYYY-MM-DD - {Agent} - {Scope}

**Date**: YYYY-MM-DD
**Mode**: {Agent Name}
**Scope**: {Description}
**Linear**: {Issue ID}

## Summary
{1-2 sentences}

## Files Touched
- `path/to/file` - {What changed}

## Key Decisions
- {Decision with rationale}

## Next Steps
- [ ] {Action item}
```

### 6. Constitution & Memory

**Memory Files**:
- `constitution.md` - Core principles
- `architecture.md` - System design
- `tech-stack.md` - Technology decisions
- `glossary.md` - Domain terms
- `changelog.md` - Project history

---

## What OmO Brings to Us

### 1. Background Task System

**Pattern**:
```typescript
// Fire multiple agents in parallel
background_task(agent="explore", prompt="Find auth implementations...")
background_task(agent="explore", prompt="Find auth tests...")
background_task(agent="librarian", prompt="Look up NextAuth docs...")

// Continue working, collect later
const results = background_output()
```

**Value**: 40-60% performance improvement for multi-agent workflows.

### 2. LSP Tools

**Capabilities**:
- `lsp_goto_definition` - Jump to symbol definition
- `lsp_find_references` - Find all usages
- `lsp_rename` - Safe symbol renaming
- `lsp_diagnostics` - Real-time error detection
- `lsp_code_actions` - Quick fixes

**Value**: Code intelligence that grep/glob can't provide.

### 3. AST-grep Tools

**Capabilities**:
- Structural code search (not text-based)
- Pattern-based code transformation
- Language-aware refactoring

**Value**: Safer, more precise code modifications.

### 4. Multi-Model Agents

**Models Available**:
- claude-opus-4-5 (OmO)
- gpt-5.2 (Oracle)
- grok-code (Explore)
- claude-sonnet-4-5 (Librarian)
- gemini-3-pro (Frontend, Document)
- gemini-2.5-flash (Multimodal)

**Value**: Best model for each task.

### 5. Hook System

**Capabilities**:
- Pre/post tool execution hooks
- Context injection
- Session management
- Auto-recovery

**Value**: Extensible behavior modification without code changes.

### 6. Extended Thinking

**Configuration**:
```typescript
thinking: {
  type: "enabled",
  budgetTokens: 32000,
}
```

**Value**: Deeper reasoning for complex tasks.

---

## Integration Strategy

### Phase 1: Governance Hooks

Create OmO hooks that enforce our governance patterns:

1. **`governance-path-validator`** - Hook that validates paths before file writes
2. **`governance-historian`** - Hook that creates changelog entries after tool execution
3. **`governance-linear-injector`** - Hook that injects Linear issue context

### Phase 2: Agent Integration

Add our specialized agents to OmO:

1. **Markdown Agents** in `.opencode/agent/`:
   - `context-steward.md`
   - `historian.md`
   - `linear-coordinator.md`
   - `product-strategist.md`
   - `strategic-architect.md`

2. **TypeScript Agents** in `src/agents/`:
   - Agents requiring complex logic
   - Agents needing custom tools

### Phase 3: Tool Integration

Port our custom tools to OmO:

1. **Linear Tools**:
   - `linear_branch` - Get branch name
   - `linear_update_status` - Update status
   - `linear_create_issue` - Create issue

2. **Project Tools**:
   - `read_context` - Read project context
   - `mintlify_sync` - Sync documentation

### Phase 4: Workflow Enhancement

Enhance OmO's workflows with our patterns:

1. **Spec-Driven Workflow** - Create specs before implementation
2. **Governance Checkpoints** - Validate paths, create changelogs
3. **Linear Lifecycle** - Issue → Branch → PR → Done

---

## Success Criteria

1. **Governance Preserved**: All file writes validated, all work logged
2. **Linear Integrated**: Issues created, branches named, status updated
3. **Spec-Driven**: Features planned in `context/specs/` before implementation
4. **Background Tasks**: Parallel agent execution working
5. **LSP/AST Tools**: Code intelligence operational
6. **Hook System**: Governance hooks enforcing patterns
7. **Multi-Model**: Right model for each task

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OmO's flexibility bypasses governance | High | Create blocking hooks that enforce paths |
| Agent confusion between systems | Medium | Clear naming, documentation |
| Performance regression | Medium | Benchmark before/after |
| Breaking existing workflows | High | Preserve fallback to original orchestrator |

---

## References

- **OmO Source**: `/Users/eru/Documents/GitHub/oh-my-opencode/`
- **Our System**: `/Users/eru/Documents/GitHub/project-template/.opencode/`
- **Linear Issue**: [LIF-57](https://linear.app/lifelogger/issue/LIF-57)
- **Research Docs**: `/Users/eru/Documents/GitHub/oh-my-opencode/docs/`
