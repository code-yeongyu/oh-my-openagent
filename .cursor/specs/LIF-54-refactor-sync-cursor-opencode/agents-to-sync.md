# Shared Agents Audit - LIF-54 Phase 3

**Created**: 2025-12-16  
**Purpose**: Definitive list of 21 shared agents to sync from Cursor to OpenCode  
**Task**: T015 - Audit Shared Agents List  
**Linear Issue**: [LIF-54](https://linear.app/lifelogger/issue/LIF-54/sync-cursor-and-opencode-agentcommandtemplate-directories)

---

## Sync Strategy

### Source of Truth
- **Source**: `.cursor/agents/{agent}.md` (Cursor format)
- **Destination**: `.opencode/agent/{agent}.md` (OpenCode format)

### Critical: Flat Agent Structure

**OpenCode uses FLAT agent structure** - all agents live directly in `.opencode/agent/`, NOT in categorized subdirectories.

This was established in Phase 1.5 where we fixed 94 categorized path references in orchestrator.md:
- ❌ WRONG: `.opencode/agent/governance/context-steward.md`
- ✅ CORRECT: `.opencode/agent/context-steward.md`

Categories below are **logical groupings for documentation only**, not file paths.

### Sync Format Rules

1. **Preserve YAML frontmatter** - Keep OpenCode-specific fields:
   - `description` - Brief agent purpose
   - `mode` - `all` or `subagent`
   - `model` - Model identifier (e.g., `claude-sonnet-4-20250514`)
   - `temperature` - Model temperature setting
   - `tools` - Tool permissions object

2. **Update content sections** - Sync from Cursor:
   - Role description
   - Capabilities
   - Instructions
   - Guardrails
   - Delegation patterns
   - Integration details

3. **Fix delegation references** - Convert Cursor format to OpenCode:
   - `@Agent-Name` → `task(subagent_type: "agent-name")`
   - `Delegate to governance/context-steward` → `Delegate to context-steward`

4. **Fix path references** - Update file paths:
   - `.cursor/agents/` → `.opencode/agent/`
   - `.cursor/specs/` → `.cursor/specs/` (unchanged - shared location)
   - `.cursor/memory/` → `.cursor/memory/` (unchanged - shared location)

---

## Shared Agents to Sync (21 total)

### Governance (5 agents)

Critical agents for project organization and audit trail.

| Agent | Source | Destination | Priority | Notes |
|-------|--------|-------------|----------|-------|
| context-steward | `.cursor/agents/context-steward.md` | `.opencode/agent/context-steward.md` | **Critical** | Path validation, must sync first |
| historian | `.cursor/agents/historian.md` | `.opencode/agent/historian.md` | **Critical** | Audit trail, changelog |
| agent-auditor | `.cursor/agents/agent-auditor.md` | `.opencode/agent/agent-auditor.md` | High | Agent compliance |
| meta-improvement-analyst | `.cursor/agents/meta-improvement-analyst.md` | `.opencode/agent/meta-improvement-analyst.md` | Medium | Process improvement |
| mode-auditor | `.cursor/agents/mode-auditor.md` | `.opencode/agent/mode-auditor.md` | Medium | Mode compliance |

### Planning (3 agents)

Agents for requirements, architecture, and project management.

| Agent | Source | Destination | Priority | Notes |
|-------|--------|-------------|----------|-------|
| product-strategist | `.cursor/agents/product-strategist.md` | `.opencode/agent/product-strategist.md` | **Critical** | `/specify` workflow |
| strategic-architect | `.cursor/agents/strategic-architect.md` | `.opencode/agent/strategic-architect.md` | **Critical** | Architecture design |
| linear-coordinator | `.cursor/agents/linear-coordinator.md` | `.opencode/agent/linear-coordinator.md` | High | Linear integration |

### Implementation (3 agents)

Agents for code implementation and deployment.

| Agent | Source | Destination | Priority | Notes |
|-------|--------|-------------|----------|-------|
| implementation-specialist | `.cursor/agents/implementation-specialist.md` | `.opencode/agent/implementation-specialist.md` | **Critical** | `/implement` workflow |
| quick-fixer | `.cursor/agents/quick-fixer.md` | `.opencode/agent/quick-fixer.md` | High | Hotfixes, urgent bugs |
| devops-specialist | `.cursor/agents/devops-specialist.md` | `.opencode/agent/devops-specialist.md` | Medium | Infrastructure, CI/CD |

### Quality (4 agents)

Agents for code review, testing, and documentation.

| Agent | Source | Destination | Priority | Notes |
|-------|--------|-------------|----------|-------|
| code-reviewer | `.cursor/agents/code-reviewer.md` | `.opencode/agent/code-reviewer.md` | **Critical** | `/code-review` workflow |
| test-engineer | `.cursor/agents/test-engineer.md` | `.opencode/agent/test-engineer.md` | High | Test coverage |
| documentation-master | `.cursor/agents/documentation-master.md` | `.opencode/agent/documentation-master.md` | Medium | Technical docs |
| chat-auditor | `.cursor/agents/chat-auditor.md` | `.opencode/agent/chat-auditor.md` | Low | Chat compliance |

### Specialized (6 agents)

Domain-specific expert agents.

| Agent | Source | Destination | Priority | Notes |
|-------|--------|-------------|----------|-------|
| rag-architect | `.cursor/agents/rag-architect.md` | `.opencode/agent/rag-architect.md` | Medium | RAG systems |
| ml-engineer | `.cursor/agents/ml-engineer.md` | `.opencode/agent/ml-engineer.md` | Medium | ML/AI implementation |
| ai-engineer-agentic | `.cursor/agents/ai-engineer-agentic.md` | `.opencode/agent/ai-engineer-agentic.md` | Medium | Agentic AI systems |
| web-design-guru | `.cursor/agents/web-design-guru.md` | `.opencode/agent/web-design-guru.md` | Low | Web design |
| project-guru | `.cursor/agents/project-guru.md` | `.opencode/agent/project-guru.md` | Low | Project knowledge |
| brd-creator | `.cursor/agents/brd-creator.md` | `.opencode/agent/brd-creator.md` | Low | Business requirements |

**Note**: `rule-engineer` exists in both directories but is counted in the 21 shared agents.

---

## OpenCode-Only Agents (DO NOT SYNC - 4 agents)

These agents exist only in OpenCode and must be **preserved, not overwritten**.

| Agent | Location | Purpose | Why OpenCode-Only |
|-------|----------|---------|-------------------|
| orchestrator | `.opencode/agent/orchestrator.md` | Task delegation orchestrator | OpenCode-specific tool-based delegation |
| agent-engineer | `.opencode/agent/agent-engineer.md` | OpenCode agent development | Maintains OpenCode agent system |
| research | `.opencode/agent/research.md` | Research tasks | OpenCode research workflow |
| conversation-auditor | `.opencode/agent/conversation-auditor.md` | Conversation compliance | OpenCode-specific auditing |

### Protection Rules

1. **Never overwrite** these files during sync operations
2. **Never delete** these files
3. **Document** any changes to these agents separately
4. **Test** these agents after sync to ensure no regressions

---

## Sync Priority Order

For Phase 3 implementation, sync agents in this order:

### Wave 1: Critical Path (sync first)
1. `context-steward` - Required by all other agents for path validation
2. `historian` - Required for audit trail
3. `product-strategist` - Required for `/specify` workflow
4. `implementation-specialist` - Required for `/implement` workflow
5. `code-reviewer` - Required for `/code-review` workflow

### Wave 2: High Priority
6. `strategic-architect`
7. `linear-coordinator`
8. `quick-fixer`
9. `test-engineer`
10. `agent-auditor`

### Wave 3: Medium Priority
11. `meta-improvement-analyst`
12. `mode-auditor`
13. `devops-specialist`
14. `documentation-master`
15. `rag-architect`
16. `ml-engineer`
17. `ai-engineer-agentic`

### Wave 4: Low Priority
18. `web-design-guru`
19. `project-guru`
20. `brd-creator`
21. `chat-auditor`

---

## Validation Checklist

After syncing each agent, verify:

- [ ] YAML frontmatter preserved (mode, model, temperature, tools)
- [ ] Content sections updated from Cursor source
- [ ] All `@Agent-Name` references converted to `task(subagent_type: "agent-name")`
- [ ] All categorized paths converted to flat paths
- [ ] No references to `.cursor/agents/` (should be `.opencode/agent/`)
- [ ] Agent can be invoked via `task(subagent_type: "agent-name")`
- [ ] No broken delegation chains

---

## Summary

| Category | Count | Priority Distribution |
|----------|-------|----------------------|
| Governance | 5 | 2 Critical, 1 High, 2 Medium |
| Planning | 3 | 2 Critical, 1 High |
| Implementation | 3 | 1 Critical, 1 High, 1 Medium |
| Quality | 4 | 1 Critical, 1 High, 1 Medium, 1 Low |
| Specialized | 6 | 3 Medium, 3 Low |
| **Total to Sync** | **21** | 6 Critical, 4 High, 7 Medium, 4 Low |
| **OpenCode-Only** | **4** | N/A (preserve) |

---

## Phase 3 Completion Summary

**Completed**: 2025-12-16  
**Completed By**: Implementation Specialist  

### What Was Done

All 21 shared agents were synced with flat delegation references:

1. **Delegation references fixed** - Changed categorized paths to flat names:
   - `governance/context-steward` → `context-steward`
   - `governance/historian` → `historian`
   - `planning/linear-coordinator` → `linear-coordinator`
   - `planning/strategic-architect` → `strategic-architect`
   - `planning/product-strategist` → `product-strategist`
   - `implementation/implementation-specialist` → `implementation-specialist`
   - `implementation/quick-fixer` → `quick-fixer`
   - `implementation/devops-specialist` → `devops-specialist`
   - `quality/code-reviewer` → `code-reviewer`
   - `quality/test-engineer` → `test-engineer`
   - `quality/documentation-master` → `documentation-master`
   - `quality/chat-auditor` → `chat-auditor`
   - `specialized/rag-architect` → `rag-architect`
   - `specialized/ml-engineer` → `ml-engineer`
   - `specialized/ai-engineer-agentic` → `ai-engineer-agentic`
   - `specialized/web-design-guru` → `web-design-guru`
   - `specialized/project-guru` → `project-guru`
   - `specialized/brd-creator` → `brd-creator`

2. **OpenCode-only agents preserved** (NOT touched):
   - `orchestrator.md`
   - `agent-engineer.md`
   - `research.md`
   - `conversation-auditor.md`

3. **Verification completed**:
   - Grep confirmed no remaining categorized delegation references in 21 shared agents
   - Remaining category references are legitimate file paths (e.g., `.cursor/rules/05-quality/`) or folder names (`implementation/`)

### Files Modified (21 agents)

- `.opencode/agent/context-steward.md`
- `.opencode/agent/historian.md`
- `.opencode/agent/agent-auditor.md`
- `.opencode/agent/meta-improvement-analyst.md`
- `.opencode/agent/mode-auditor.md`
- `.opencode/agent/product-strategist.md`
- `.opencode/agent/strategic-architect.md`
- `.opencode/agent/linear-coordinator.md`
- `.opencode/agent/implementation-specialist.md`
- `.opencode/agent/quick-fixer.md`
- `.opencode/agent/devops-specialist.md`
- `.opencode/agent/code-reviewer.md`
- `.opencode/agent/test-engineer.md`
- `.opencode/agent/documentation-master.md`
- `.opencode/agent/chat-auditor.md`
- `.opencode/agent/rag-architect.md`
- `.opencode/agent/ml-engineer.md`
- `.opencode/agent/ai-engineer-agentic.md`
- `.opencode/agent/web-design-guru.md`
- `.opencode/agent/project-guru.md`
- `.opencode/agent/brd-creator.md`

---

**Last Updated**: 2025-12-16  
**Created By**: Implementation Specialist  
**Status**: ✅ Phase 3 Complete
