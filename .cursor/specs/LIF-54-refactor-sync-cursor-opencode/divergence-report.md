---
title: Divergence Report - Cursor vs OpenCode Directories
feature_id: LIF-54-refactor-sync-cursor-opencode
date: 2025-12-16
author: Implementation Specialist
---

# Divergence Report: Cursor vs OpenCode Directories

**Report Date**: 2025-12-16  
**Linear Issue**: [LIF-54](https://linear.app/lifelogger/issue/LIF-54/sync-cursor-and-opencode-agentcommandtemplate-directories)  
**Purpose**: Document all differences between `.cursor/` and `.opencode/` directories to guide synchronization efforts.

---

## Executive Summary

This report provides a comprehensive audit of divergences between the Cursor IDE (`.cursor/`) and OpenCode CLI (`.opencode/`) directory structures. The analysis reveals:

| Metric | Count |
|--------|-------|
| **Total Cursor Commands** | 33 |
| **Total OpenCode Commands** | 12 |
| **Commands Synced & Verified** | 5 |
| **Commands Needing Sync Verification** | 5 |
| **Commands Missing from OpenCode** | 21 |
| **OpenCode-Only Commands** | 2 |
| **Total Cursor Agents** | 21 |
| **Total OpenCode Agents** | 26 |
| **Shared Agents** | 21 |
| **OpenCode-Only Agents** | 4 |

### Key Findings

1. **Commands**: 21 Cursor commands need porting to OpenCode (63% gap)
2. **Agents**: All 21 Cursor agents exist in OpenCode, but content sync needed
3. **Structure**: OpenCode uses FLAT agent structure despite categorized path references in orchestrator
4. **Verified Syncs**: 5 commands confirmed working with correct `.opencode/agent/` path references
5. **OpenCode-Specific**: 4 agents and 2 commands are OpenCode-only (preserve, don't sync)

### Sync Priority Recommendation

| Priority | Items | Rationale |
|----------|-------|-----------|
| **P1 - Critical** | Verify 5 remaining commands (specify, plan, tasks, implement, superwhisper-mode) | Core workflow commands |
| **P2 - High** | Port 3 medium-priority commands (sync-linear, create-pr, debug-issue) | Common development workflows |
| **P3 - Medium** | Sync 21 agent definitions (content update) | Ensure latest capabilities |
| **P4 - Low** | Port 18 remaining commands | Specialized workflows |

---

## Commands Comparison

### Summary Table

| Status | Count | Description |
|--------|-------|-------------|
| ✅ Synced & Verified | 5 | Working in OpenCode with correct paths |
| 🔄 Needs Verification | 5 | Exists in both, sync status unknown |
| ❌ Missing from OpenCode | 21 | Cursor-only, needs porting |
| 🆕 OpenCode-Only | 2 | Preserve, don't sync to Cursor |

### ✅ Synced & Verified Commands (5)

These commands have been verified working in OpenCode with correct `.opencode/agent/` path references:

| Command | Cursor Path | OpenCode Path | Verification Status |
|---------|-------------|---------------|---------------------|
| `analyze.md` | `.cursor/commands/analyze.md` | `.opencode/command/analyze.md` | ✅ Path refs updated |
| `checklist.md` | `.cursor/commands/checklist.md` | `.opencode/command/checklist.md` | ✅ Path refs updated |
| `clarify.md` | `.cursor/commands/clarify.md` | `.opencode/command/clarify.md` | ✅ Path refs updated |
| `code-review.md` | `.cursor/commands/code-review.md` | `.opencode/command/code-review.md` | ✅ Path refs updated |
| `update-context.md` | `.cursor/commands/update-context.md` | `.opencode/command/update-context.md` | ✅ Path refs updated |

**Verification Details**:
- All 5 commands reference `.opencode/agent/` paths correctly
- Agent delegation patterns use OpenCode format
- No broken references detected

### 🔄 Commands Needing Sync Verification (5)

These commands exist in both directories but need verification:

| Command | Cursor Path | OpenCode Path | Action Required |
|---------|-------------|---------------|-----------------|
| `specify.md` | `.cursor/commands/specify.md` | `.opencode/command/specify.md` | Verify path refs |
| `plan.md` | `.cursor/commands/plan.md` | `.opencode/command/plan.md` | Verify path refs |
| `tasks.md` | `.cursor/commands/tasks.md` | `.opencode/command/tasks.md` | Verify path refs |
| `implement.md` | `.cursor/commands/implement.md` | `.opencode/command/implement.md` | Verify path refs |
| `superwhisper-mode.md` | `.cursor/commands/superwhisper-mode.md` | `.opencode/command/superwhisper-mode.md` | Verify path refs |

**Verification Checklist**:
- [ ] Check agent path references use `.opencode/agent/` format
- [ ] Verify delegation patterns use `task(subagent_type: "category/agent")`
- [ ] Test command execution in OpenCode CLI
- [ ] Confirm output matches Cursor behavior

### ❌ Commands Missing from OpenCode (21)

#### High Priority - Port First (3)

| Command | Purpose | Complexity | Dependencies |
|---------|---------|------------|--------------|
| `sync-linear.md` | Sync with Linear issues | Medium | Linear MCP |
| `create-pr.md` | Create GitHub PRs | Medium | GitHub integration |
| `debug-issue.md` | Debug reported issues | Medium | implementation-specialist |

#### Medium Priority (4)

| Command | Purpose | Complexity | Dependencies |
|---------|---------|------------|--------------|
| `refactor-code.md` | Code refactoring workflows | Low | code-reviewer |
| `security-audit.md` | Security analysis | Medium | code-reviewer |
| `write-unit-tests.md` | Generate unit tests | Medium | test-engineer |
| `add-documentation.md` | Add documentation | Low | documentation-master |

#### Low Priority (14)

| Command | Purpose | Notes |
|---------|---------|-------|
| `add-error-handling.md` | Add error handling | Specialized |
| `address-github-pr-comments.md` | Address PR comments | GitHub-specific |
| `create-prs-from-branches.md` | Batch PR creation | Specialized |
| `run-all-tests-and-fix.md` | Run and fix tests | test-engineer |
| `optimize-performance.md` | Performance optimization | Specialized |
| `lint-fix.md` | Fix linting issues | Simple |
| `discuss.md` | Discussion mode | Simple |
| `impl-plan.md` | Implementation planning | Overlaps with plan.md |
| `create-command.md` | Create new commands | Meta |
| `try-hard.md` | Intensive problem solving | Specialized |
| `proceed.md` | Continue workflow | Simple |
| `speckit.constitution.md` | Constitution setup | Project-specific |
| `1-deep-review-project.md` | Deep project review | Specialized |
| `NR-review-pr.md` | PR review (project-specific) | May skip |

#### Skip - Not Applicable (2)

| Command | Reason |
|---------|--------|
| `conductor.md` | Maps to `orchestrator.md` in OpenCode |
| `conductor.help.md` | Low value; create `orchestrator.help.md` if needed |

### 🆕 OpenCode-Only Commands (2)

These commands are specific to OpenCode and should NOT be synced to Cursor:

| Command | Purpose | Preserve |
|---------|---------|----------|
| `orchestrator.md` | Entry point for task delegation (equivalent to conductor.md) | ✅ Yes |
| `init-project.md` | Initialize project context | ✅ Yes |

---

## Agents Comparison

### Summary Table

| Status | Count | Description |
|--------|-------|-------------|
| 🔄 Shared (needs content sync) | 21 | Exists in both, content may differ |
| 🆕 OpenCode-Only | 4 | Preserve, don't sync to Cursor |
| ❌ Cursor-Only | 0 | All Cursor agents exist in OpenCode |

### Structural Difference: Flat vs Categorized

**Critical Finding**: OpenCode agents are stored in a **FLAT structure** (all in `.opencode/agent/`), but the orchestrator and some commands reference **categorized paths** (e.g., `governance/context-steward`).

| Aspect | Cursor | OpenCode (Actual) | OpenCode (Referenced) |
|--------|--------|-------------------|----------------------|
| Structure | Flat | Flat | Categorized |
| Path | `.cursor/agents/{agent}.md` | `.opencode/agent/{agent}.md` | `.opencode/agent/{category}/{agent}.md` |
| Example | `context-steward.md` | `context-steward.md` | `governance/context-steward.md` |

**Recommendation**: Either:
1. Reorganize OpenCode agents into category folders, OR
2. Update orchestrator/commands to use flat paths

### 🔄 Shared Agents - By Category (21)

#### Governance (5 agents)

| Agent | Cursor | OpenCode | Content Sync Status |
|-------|--------|----------|---------------------|
| `context-steward.md` | ✅ | ✅ | 🔄 Needs verification |
| `historian.md` | ✅ | ✅ | 🔄 Needs verification |
| `agent-auditor.md` | ✅ | ✅ | 🔄 Needs verification |
| `meta-improvement-analyst.md` | ✅ | ✅ | 🔄 Needs verification |
| `mode-auditor.md` | ✅ | ✅ | 🔄 Needs verification |

#### Planning (3 agents)

| Agent | Cursor | OpenCode | Content Sync Status |
|-------|--------|----------|---------------------|
| `product-strategist.md` | ✅ | ✅ | 🔄 Needs verification |
| `strategic-architect.md` | ✅ | ✅ | 🔄 Needs verification |
| `linear-coordinator.md` | ✅ | ✅ | 🔄 Needs verification |

#### Implementation (3 agents)

| Agent | Cursor | OpenCode | Content Sync Status |
|-------|--------|----------|---------------------|
| `implementation-specialist.md` | ✅ | ✅ | 🔄 Needs verification |
| `quick-fixer.md` | ✅ | ✅ | 🔄 Needs verification |
| `devops-specialist.md` | ✅ | ✅ | 🔄 Needs verification |

#### Quality (4 agents)

| Agent | Cursor | OpenCode | Content Sync Status |
|-------|--------|----------|---------------------|
| `code-reviewer.md` | ✅ | ✅ | 🔄 Needs verification |
| `test-engineer.md` | ✅ | ✅ | 🔄 Needs verification |
| `documentation-master.md` | ✅ | ✅ | 🔄 Needs verification |
| `chat-auditor.md` | ✅ | ✅ | 🔄 Needs verification |

#### Specialized (6 agents)

| Agent | Cursor | OpenCode | Content Sync Status |
|-------|--------|----------|---------------------|
| `rag-architect.md` | ✅ | ✅ | 🔄 Needs verification |
| `ml-engineer.md` | ✅ | ✅ | 🔄 Needs verification |
| `ai-engineer-agentic.md` | ✅ | ✅ | 🔄 Needs verification |
| `web-design-guru.md` | ✅ | ✅ | 🔄 Needs verification |
| `project-guru.md` | ✅ | ✅ | 🔄 Needs verification |
| `brd-creator.md` | ✅ | ✅ | 🔄 Needs verification |
| `rule-engineer.md` | ✅ | ✅ | 🔄 Needs verification |

### 🆕 OpenCode-Only Agents (4)

These agents are specific to OpenCode and should NOT be synced to Cursor:

| Agent | Purpose | Category | Preserve |
|-------|---------|----------|----------|
| `orchestrator.md` | Entry point for task delegation | Orchestration | ✅ Yes |
| `research.md` | Research and investigation tasks | Specialized | ✅ Yes |
| `conversation-auditor.md` | Conversation compliance auditing | Governance | ✅ Yes |
| `agent-engineer.md` | OpenCode agent development | Specialized | ✅ Yes |

---

## Format Differences

### Agent Definition Format

| Aspect | Cursor Format | OpenCode Format |
|--------|---------------|-----------------|
| **Frontmatter** | None or minimal | YAML with `name`, `description`, `mode`, `model`, `tools` |
| **Sections** | Free-form markdown | Structured: Role, Capabilities, Instructions, Guardrails |
| **Delegation** | `@Agent-Name` | `task(subagent_type: "category/agent")` |
| **Path References** | `.cursor/agents/` | `.opencode/agent/` |

### Command Definition Format

| Aspect | Cursor Format | OpenCode Format |
|--------|---------------|-----------------|
| **Frontmatter** | None | YAML with `description`, `handoffs` |
| **Agent References** | `@Agent-Name` | `task(subagent_type: "category/agent")` |
| **Path References** | `.cursor/` | `.opencode/` |

---

## Recommendations for Phase 2-5

### Phase 2: Port Medium-Priority Commands (P1)

**Tasks**:
1. Port `sync-linear.md` to `.opencode/command/sync-linear.md`
2. Port `create-pr.md` to `.opencode/command/create-pr.md`
3. Port `debug-issue.md` to `.opencode/command/debug-issue.md`

**Translation Checklist**:
- [ ] Add YAML frontmatter (`description`, `handoffs`)
- [ ] Convert `@Agent-Name` → `task(subagent_type: "category/agent")`
- [ ] Update all path references to `.opencode/`
- [ ] Test in OpenCode CLI

### Phase 3: Sync Agent Definitions (P2)

**Tasks**:
1. For each of 21 shared agents:
   - Read Cursor version
   - Apply content to OpenCode version (preserve YAML frontmatter)
   - Update delegation patterns
   - Verify no broken references

**Decision Required**: Flat vs Categorized Structure
- **Option A**: Keep flat structure, update orchestrator to use flat paths
- **Option B**: Reorganize into category folders (governance/, planning/, etc.)

**Recommendation**: Option B (categorized) for better organization and consistency with orchestrator references.

### Phase 4: Port Low-Priority Commands (P3)

**Tasks**:
1. Port 18 remaining commands (see priority list above)
2. Document intentionally skipped commands with rationale
3. Create complete command inventory

**Batch Processing Strategy**:
- Group by complexity (simple, medium, complex)
- Port simple commands first for quick wins
- Test in batches of 5

### Phase 5: Documentation & Maintenance (P2)

**Tasks**:
1. Update translation guide with lessons learned
2. Create sync checklist for future maintenance
3. Document OpenCode-only features in README
4. Establish maintenance procedures

**Deliverables**:
- `.opencode/instructions/cursor-opencode-sync.md` (updated)
- `.cursor/scripts/sync-checklist.md` (new)
- `.opencode/README.md` (updated)
- `.opencode/instructions/sync-maintenance.md` (new)

---

## Appendix A: Complete Command Inventory

### Cursor Commands (33 total)

```
.cursor/commands/
├── 1-deep-review-project.md
├── add-documentation.md
├── add-error-handling.md
├── address-github-pr-comments.md
├── analyze.md                    ✅ Synced
├── checklist.md                  ✅ Synced
├── clarify.md                    ✅ Synced
├── code-review.md                ✅ Synced
├── conductor.help.md
├── conductor.md                  → orchestrator.md
├── create-command.md
├── create-pr.md                  ❌ Port (Medium)
├── create-prs-from-branches.md
├── debug-issue.md                ❌ Port (Medium)
├── discuss.md
├── impl-plan.md
├── implement.md                  🔄 Verify
├── lint-fix.md
├── NR-review-pr.md
├── optimize-performance.md
├── plan.md                       🔄 Verify
├── proceed.md
├── refactor-code.md              ❌ Port (Low)
├── run-all-tests-and-fix.md
├── security-audit.md             ❌ Port (Low)
├── specify.md                    🔄 Verify
├── speckit.constitution.md
├── superwhisper-mode.md          🔄 Verify
├── sync-linear.md                ❌ Port (Medium)
├── tasks.md                      🔄 Verify
├── try-hard.md
├── update-context.md             ✅ Synced
└── write-unit-tests.md           ❌ Port (Low)
```

### OpenCode Commands (12 total)

```
.opencode/command/
├── analyze.md                    ✅ Synced
├── checklist.md                  ✅ Synced
├── clarify.md                    ✅ Synced
├── code-review.md                ✅ Synced
├── implement.md                  🔄 Verify
├── init-project.md               🆕 OpenCode-only
├── orchestrator.md               🆕 OpenCode-only
├── plan.md                       🔄 Verify
├── specify.md                    🔄 Verify
├── superwhisper-mode.md          🔄 Verify
├── tasks.md                      🔄 Verify
└── update-context.md             ✅ Synced
```

---

## Appendix B: Complete Agent Inventory

### Cursor Agents (21 total)

```
.cursor/agents/
├── agent-auditor.md
├── ai-engineer-agentic.md
├── brd-creator.md
├── chat-auditor.md
├── code-reviewer.md
├── context-steward.md
├── devops-specialist.md
├── documentation-master.md
├── historian.md
├── implementation-specialist.md
├── linear-coordinator.md
├── meta-improvement-analyst.md
├── ml-engineer.md
├── mode-auditor.md
├── product-strategist.md
├── project-guru.md
├── quick-fixer.md
├── rag-architect.md
├── rule-engineer.md
├── strategic-architect.md
├── test-engineer.md
└── web-design-guru.md
```

### OpenCode Agents (26 total)

```
.opencode/agent/
├── agent-auditor.md
├── agent-engineer.md             🆕 OpenCode-only
├── ai-engineer-agentic.md
├── brd-creator.md
├── chat-auditor.md
├── code-reviewer.md
├── context-steward.md
├── conversation-auditor.md       🆕 OpenCode-only
├── devops-specialist.md
├── documentation-master.md
├── historian.md
├── implementation-specialist.md
├── linear-coordinator.md
├── meta-improvement-analyst.md
├── ml-engineer.md
├── mode-auditor.md
├── orchestrator.md               🆕 OpenCode-only
├── product-strategist.md
├── project-guru.md
├── quick-fixer.md
├── rag-architect.md
├── research.md                   🆕 OpenCode-only
├── rule-engineer.md
├── strategic-architect.md
├── test-engineer.md
└── web-design-guru.md
```

---

## Appendix C: Translation Quick Reference

### Agent Path Translation

| Cursor Reference | OpenCode Reference |
|------------------|-------------------|
| `@Context-Steward` | `task(subagent_type: "governance/context-steward")` |
| `@Historian` | `task(subagent_type: "governance/historian")` |
| `@Product-Strategist` | `task(subagent_type: "planning/product-strategist")` |
| `@Strategic-Architect` | `task(subagent_type: "planning/strategic-architect")` |
| `@Linear-Coordinator` | `task(subagent_type: "planning/linear-coordinator")` |
| `@Implementation-Specialist` | `task(subagent_type: "implementation/implementation-specialist")` |
| `@Quick-Fixer` | `task(subagent_type: "implementation/quick-fixer")` |
| `@Code-Reviewer` | `task(subagent_type: "quality/code-reviewer")` |
| `@Test-Engineer` | `task(subagent_type: "quality/test-engineer")` |
| `@Documentation-Master` | `task(subagent_type: "quality/documentation-master")` |

### Category Mapping

| Category | Agents |
|----------|--------|
| `governance/` | context-steward, historian, agent-auditor, meta-improvement-analyst, mode-auditor |
| `planning/` | product-strategist, strategic-architect, linear-coordinator |
| `implementation/` | implementation-specialist, quick-fixer, devops-specialist |
| `quality/` | code-reviewer, test-engineer, documentation-master, chat-auditor |
| `specialized/` | rag-architect, ml-engineer, ai-engineer-agentic, web-design-guru, project-guru, brd-creator, rule-engineer |

---

**Report Generated**: 2025-12-16  
**Author**: Implementation Specialist  
**Next Action**: Proceed to Phase 2 - Port Medium-Priority Commands
