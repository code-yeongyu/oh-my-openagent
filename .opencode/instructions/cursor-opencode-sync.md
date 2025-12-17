# Cursor ↔ OpenCode Sync Guide

> This document defines the synchronization strategy between `.cursor/` and `.opencode/` directories.

## Sync Principles

### Source of Truth

| Resource Type | Source of Truth | Reason |
|---------------|-----------------|--------|
| **Shared Resources** | `.cursor/` | Always active in Cursor IDE |
| **Agent Definitions** | Both (sync required) | Different formats, same logic |
| **Commands** | Both (sync required) | Different invocation patterns |
| **Templates (spec-driven)** | `.cursor/templates/` | Used by spec workflow |
| **Templates (project init)** | `.opencode/templates/` | Used by init-project tool |
| **Custom Tools** | `.opencode/tool/` | OpenCode-specific |
| **Memory/Specs** | `.cursor/` | Shared, always in cursor |

### Shared Resources (Unchanged)

These resources are shared and should NOT be duplicated:

```
.cursor/specs/           → Feature specification folders
.cursor/memory/          → Constitution, architecture, tech-stack, glossary
.cursor/templates/       → Spec templates (spec-template.md, plan-template.md, etc.)
.cursor/scripts/         → Bash scripts (create-feature.sh, etc.)
.cursor/rules/           → Project rules (organized by category)
.cursor/changelog/       → Project-level changelog
```

## Path Reference Translation

### Agent Path Translation

When syncing agents, translate path references:

| Cursor Reference | OpenCode Reference |
|------------------|-------------------|
| `.cursor/agents/{agent}.md` | `.opencode/agent/{agent}.md` |
| `@{Agent-Name}` | `task(subagent_type: "{agent}")` |

> **Note**: Both Cursor and OpenCode use **flat agent structure**. Agent names are identical in both systems (e.g., `context-steward`, `product-strategist`). Categories are for logical grouping only, not path structure.

### Agent Logical Categories

Agents are logically grouped but stored in flat structure:

| Category | Agents |
|----------|--------|
| **Governance** | `context-steward`, `historian`, `agent-auditor`, `meta-improvement-analyst`, `mode-auditor` |
| **Planning** | `product-strategist`, `strategic-architect`, `linear-coordinator` |
| **Implementation** | `implementation-specialist`, `quick-fixer`, `devops-specialist` |
| **Quality** | `code-reviewer`, `test-engineer`, `documentation-master`, `chat-auditor` |
| **Specialized** | `rag-architect`, `ml-engineer`, `ai-engineer-agentic`, `web-design-guru`, `project-guru`, `brd-creator`, `rule-engineer`, `agent-engineer`, `research` |

### Delegation Pattern Translation

**Cursor (command context - uses @ mentions):**
```markdown
@Product-Strategist Plan user authentication feature

Product Strategist:
1. Calls Context Steward: "Validate path for 'user authentication'"
2. Context Steward returns: ".cursor/specs/POLY-42-feat-user-authentication/"
3. Product Strategist writes to: .cursor/specs/POLY-42-feat-user-authentication/spec.md
```

**OpenCode (agent with task tool):**
```markdown
task(
  description: "Plan user authentication feature",
  prompt: "Define requirements for user authentication feature.
  Call context-steward for path validation first.
  Create spec.md in validated path.
  Call historian for changelog after completion.",
  subagent_type: "product-strategist"
)
```

> **Note**: OpenCode uses flat agent names (e.g., `product-strategist`, `context-steward`) not categorized paths.

## Agent Format Differences

### Cursor Agent Format

```markdown
# {Agent Name} Agent

## Agent Summary
- **Purpose**: {purpose}
- **Use when**: {use cases}
- **MCPs**: {mcp servers}
- **File size**: {lines} lines

## Custom Instructions

\`\`\`
PURPOSE: {purpose}

PROJECT CONTEXT:
- {context items}

SCOPE BOUNDARIES:
- In: {in scope}
- Out: {out of scope}

STEPS:
1. {step 1}
2. {step 2}

GUARDRAILS:
- {guardrail 1}
- {guardrail 2}
\`\`\`
```

### OpenCode Agent Format

```markdown
---
mode: subagent
model: opencode/gemini-3-flash
temperature: 0.5
tools:
  read: true
  write: true
  task: true
  linear_get_issue: true
description: {Agent Name}
---

# {Agent Name}

## Role

{Role description}

## Capabilities

- {capability 1}
- {capability 2}

## Instructions

### Pre-Flight

{Pre-flight checks}

### Main Workflow

{Main workflow steps}

## Guardrails

- {guardrail 1}
- {guardrail 2}

## Delegation

This agent can delegate to:
- {agent}: {reason}

This agent is invoked by:
- {invoker 1}
- {invoker 2}

## Integration

### Linear Integration
{Linear integration details}

### Other Integrations
{Other integration details}
```

## Sync Procedures

### Syncing an Agent (Cursor → OpenCode)

1. **Read Cursor agent**: `.cursor/agents/{agent}.md`
2. **Read OpenCode agent**: `.opencode/agent/{agent}.md`
3. **Preserve OpenCode structure**:
   - Keep YAML frontmatter (mode, model, temperature, tools)
   - Keep section structure (Role, Capabilities, Instructions, Guardrails, Delegation, Integration)
4. **Sync content**:
   - Update Role/Purpose from Cursor
   - Update Instructions/Steps from Cursor
   - Update Guardrails from Cursor
   - Translate path references (`.cursor/agents/` → `.opencode/agent/`)
   - Agent names remain flat in both systems
5. **Update delegation section** with flat agent names
6. **Verify** all path references are correct

### Syncing a Command (Cursor → OpenCode)

1. **Read Cursor command**: `.cursor/commands/{command}.md`
2. **Read OpenCode command**: `.opencode/command/{command}.md` (if exists)
3. **Preserve OpenCode structure**:
   - Keep YAML frontmatter (description, handoffs)
4. **Sync content**:
   - Update outline/steps from Cursor
   - Translate agent path references
   - Update agent invocation patterns
5. **Verify** all path references are correct

## Command Mapping

### Commands in Both (Sync Required)

| Command | Cursor | OpenCode | Status |
|---------|--------|----------|--------|
| `specify.md` | ✅ | ✅ | Sync agent paths |
| `plan.md` | ✅ | ✅ | Sync agent paths |
| `tasks.md` | ✅ | ✅ | Sync agent paths |
| `implement.md` | ✅ | ✅ | Sync agent paths |
| `superwhisper-mode.md` | ✅ | ✅ | Verify consistency |

### Commands to Add to OpenCode

| Command | Priority | Purpose |
|---------|----------|---------|
| `update-context.md` | High | Memory file management |
| `checklist.md` | High | Checklist generation |
| `clarify.md` | High | Requirement clarification |
| `analyze.md` | Medium | Code analysis |
| `code-review.md` | Medium | Code review workflow |
| `sync-linear.md` | Medium | Linear synchronization |
| `conductor.help.md` | Low | Conductor help (→ orchestrator.help.md) |

### OpenCode-Only Commands (Preserve)

| Command | Purpose |
|---------|---------|
| `orchestrator.md` | Delegates to orchestrator agent |
| `init-project.md` | Project initialization |

## Validation Checklist

After syncing, verify:

- [ ] All agent path references use `.opencode/agent/` in OpenCode files
- [ ] All agent names use flat format (e.g., `product-strategist`, NOT `planning/product-strategist`)
- [ ] Shared resource paths remain unchanged (`.cursor/specs/`, `.cursor/memory/`, etc.)
- [ ] YAML frontmatter preserved in OpenCode agents
- [ ] Delegation sections use flat agent names
- [ ] Sentinel markers present (`<!-- END {filename} -->`)
- [ ] Commands reference correct agent paths

## Maintenance

### When to Sync

- After significant updates to Cursor agents/commands
- After adding new workflow patterns
- After updating governance rules
- Before major releases

### Sync Frequency

- **High-frequency agents** (orchestrator, context-steward, historian): Sync immediately after changes
- **Working agents** (product-strategist, implementation-specialist, etc.): Sync weekly or after significant updates
- **Commands**: Sync after workflow changes

## Lessons Learned (LIF-54)

This section documents key lessons from the LIF-54 sync effort (December 2025).

### 1. Flat Structure is REQUIRED (Not Optional)

**Critical Discovery**: OpenCode agents MUST use a flat structure. During Phase 1, we discovered that 94+ references in orchestrator.md and governance docs used categorized paths (`governance/context-steward`) that don't match the actual flat structure.

**What Happened**:
- Documentation referenced: `.opencode/agent/governance/context-steward.md`
- Actual location: `.opencode/agent/context-steward.md`
- Result: 94 path references had to be fixed in Phase 1.5

**Rule**: Always use flat agent names in OpenCode:
- ❌ WRONG: `task(subagent_type: "governance/context-steward")`
- ✅ CORRECT: `task(subagent_type: "context-steward")`

### 2. OpenCode-Only Agents Must Be Preserved

Four agents exist only in OpenCode and must NEVER be overwritten during sync:
- `orchestrator.md` - Task delegation orchestrator (replaces conductor)
- `agent-engineer.md` - OpenCode agent development
- `research.md` - Research tasks
- `conversation-auditor.md` - Conversation compliance

### 3. YAML Frontmatter Must Be Preserved

When syncing from Cursor to OpenCode, preserve the OpenCode YAML frontmatter:
```yaml
---
mode: subagent
model: claude-sonnet-4-20250514
temperature: 0.5
tools:
  read: true
  write: true
  task: true
description: Agent Name
---
```

### 4. Historian Calls Must Be Included

All commands ported to OpenCode must include Historian governance calls for audit trail compliance.

## Updated Statistics (LIF-54 Complete)

### Agents
| Metric | Count |
|--------|-------|
| **Shared Agents** | 21 |
| **OpenCode-Only Agents** | 4 |
| **Total OpenCode Agents** | 25 |

### Commands
| Metric | Count |
|--------|-------|
| **Total Commands Ported** | 20 |
| **Pre-existing (Phase 1)** | 11 |
| **Medium Priority (Phase 2)** | 3 |
| **Low Priority (Phase 4)** | 17 |
| **Commands Skipped** | 2 |
| **OpenCode-Only Commands** | 2 |
| **Total OpenCode Commands** | 33 |

### Skipped Commands
- `conductor.md` - Maps to `orchestrator.md` in OpenCode
- `conductor.help.md` - Low value, redundant with orchestrator

## Expanded Validation Checklist

After any sync operation, verify:

### Agent Sync Validation
- [ ] Agent file exists at `.opencode/agent/{agent}.md` (flat structure)
- [ ] YAML frontmatter preserved (mode, model, temperature, tools, description)
- [ ] No categorized paths in delegation references (e.g., NO `governance/context-steward`)
- [ ] All `@Agent-Name` converted to `task(subagent_type: "agent-name")`
- [ ] Path references updated (`.cursor/agents/` → `.opencode/agent/`)
- [ ] Shared resource paths unchanged (`.cursor/specs/`, `.cursor/memory/`)
- [ ] Historian governance call included

### Command Sync Validation
- [ ] Command file exists at `.opencode/command/{command}.md`
- [ ] YAML frontmatter added with `description:` field
- [ ] Agent path references use flat names
- [ ] Historian governance call included
- [ ] No broken agent references

### Structural Validation
- [ ] Grep for categorized paths returns no matches in synced files
- [ ] File count matches expected (25 agents, 33 commands)
- [ ] OpenCode-only files preserved (4 agents, 2 commands)

## References

- Cursor agents: `.cursor/agents/`
- OpenCode agents: `.opencode/agent/`
- Cursor commands: `.cursor/commands/`
- OpenCode commands: `.opencode/command/`
- Migration archive: `.opencode/archive/`
- Sync checklist: `.cursor/scripts/sync-checklist.md`
- Maintenance procedures: `.opencode/instructions/sync-maintenance.md`
