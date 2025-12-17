# Migration Notes: Spec-Driven Framework to Open Code

## Migration Date
2024-12-19

## Overview

Migrated conductor orchestration improvements and spec-driven development patterns from `.cursor/` to `.opencode/` while preserving shared resource references and maintaining Cursor folder structure for rollback safety.

## What Was Migrated

### 1. Orchestrator Agent Enhancement
- **Source**: `.cursor/commands/conductor.md` (1893 lines)
- **Target**: `.opencode/agent/orchestrator.md`
- **Enhancements Added**:
  - Full-read enforcement with sentinel check
  - Core Flow (Step 1-5 mandatory flow)
  - Todo granularity rules (governance agents separate, work breakdown)
  - Mode reading pattern (complete reads only, no offset/limit)
  - Enhanced workflow patterns (NEW_FEATURE, BUG_FIX, PERFORMANCE, SECURITY, INFRASTRUCTURE)
  - Governance enforcement patterns
  - Context-aware decision making
  - Error handling and recovery patterns

### 2. Orchestrator Command Wrapper
- **Created**: `.opencode/command/orchestrator.md`
- **Purpose**: Command entrypoint that delegates to orchestrator agent
- **Structure**: Follows Open Code command pattern with handoffs

### 3. Workflow Documentation Migration
- **FEATURE_WORKFLOW.md**: Migrated from `.cursor/agents/FEATURE_WORKFLOW.md` → `.opencode/instructions/feature-workflow.md`
  - Updated agent references: `.cursor/agents/{agent}.md` → `.opencode/agent/{category}/{agent}.md`
  - Preserved shared resource references (`.cursor/specs/`, `.cursor/memory/`, `.cursor/templates/`, `.cursor/scripts/`)
  
- **WORKFLOW_PATTERNS.md**: Migrated from `.cursor/agents/WORKFLOW_PATTERNS.md` → `.opencode/instructions/workflow-patterns.md`
  - Updated agent references to Open Code paths
  - Updated "Railway Conductor" references to "Orchestrator"
  - Preserved shared resource references

### 4. Agent Reference Updates
- **Updated**: `.opencode/agent/governance/rule-engineer.md`
  - Changed "Railway Conductor" → "Orchestrator"
  - Changed `.cursor/commands/conductor.md` → `.opencode/agent/orchestrator.md` and `.opencode/command/orchestrator.md`
  
- **Updated**: `.opencode/agent/specialized/agent-engineer.md`
  - Changed "Railway Conductor" → "Orchestrator"
  - Changed `.cursor/commands/conductor.md` → `.opencode/agent/orchestrator.md` and `.opencode/command/orchestrator.md`

### 5. Command Verification
- **Verified**: All Open Code commands (`.opencode/command/specify.md`, `plan.md`, `tasks.md`, `implement.md`) already reference correct Open Code agent paths
- **Status**: ✅ All commands correctly reference `.opencode/agent/{category}/{agent}.md`

### 6. Agent Verification
- **Verified**: All Open Code agents already reference correct paths
- **Status**: ✅ No `.cursor/agents/` references found in Open Code agents (except migration documentation files)

## What Was Preserved

### Shared Resources (Unchanged)
These resources remain in `.cursor/` folder and are referenced by both Cursor and Open Code systems:

- **`.cursor/specs/`** - Feature spec folders (shared by both systems)
- **`.cursor/memory/`** - Constitution, architecture, tech-stack (shared)
- **`.cursor/templates/`** - Spec/plan/task templates (shared)
- **`.cursor/scripts/`** - Bash scripts (create-feature.sh, setup-plan.sh) (shared)

### Cursor Folder Structure
- **Preserved**: Entire `.cursor/` folder structure maintained for rollback safety
- **Status**: No changes made to Cursor folder (except read-only analysis)

## Reference Update Matrix

| Old Reference | New Reference | Scope |
|---------------|---------------|-------|
| `.cursor/agents/{agent}.md` | `.opencode/agent/{category}/{agent}.md` | Open Code files only |
| `conductor` | `orchestrator` | Open Code context |
| `/conductor` | `/orchestrator` | Open Code commands |
| `Railway Conductor` | `Orchestrator` | Open Code documentation |
| `.cursor/commands/conductor.md` | `.opencode/agent/orchestrator.md` + `.opencode/command/orchestrator.md` | Open Code references |
| `.cursor/specs/` | `.cursor/specs/` | **UNCHANGED** (shared) |
| `.cursor/memory/` | `.cursor/memory/` | **UNCHANGED** (shared) |
| `.cursor/templates/` | `.cursor/templates/` | **UNCHANGED** (shared) |
| `.cursor/scripts/` | `.cursor/scripts/` | **UNCHANGED** (shared) |

## Agent Mapping

All Cursor agents have corresponding Open Code agents:

| Cursor Agent | Open Code Agent | Category |
|--------------|-----------------|----------|
| `product-strategist.md` | `planning/product-strategist.md` | Planning |
| `strategic-architect.md` | `planning/strategic-architect.md` | Planning |
| `linear-coordinator.md` | `planning/linear-coordinator.md` | Planning |
| `implementation-specialist.md` | `implementation/implementation-specialist.md` | Implementation |
| `quick-fixer.md` | `implementation/quick-fixer.md` | Implementation |
| `devops-specialist.md` | `implementation/devops-specialist.md` | Implementation |
| `code-reviewer.md` | `quality/code-reviewer.md` | Quality |
| `test-engineer.md` | `quality/test-engineer.md` | Quality |
| `documentation-master.md` | `quality/documentation-master.md` | Quality |
| `chat-auditor.md` | `quality/chat-auditor.md` | Quality |
| `context-steward.md` | `governance/context-steward.md` | Governance |
| `historian.md` | `governance/historian.md` | Governance |
| `agent-auditor.md` | `governance/agent-auditor.md` | Governance |
| `meta-improvement-analyst.md` | `governance/meta-improvement-analyst.md` | Governance |
| `mode-auditor.md` | `governance/mode-auditor.md` | Governance |
| `rule-engineer.md` | `governance/rule-engineer.md` | Governance |
| `rag-architect.md` | `specialized/rag-architect.md` | Specialized |
| `ml-engineer.md` | `specialized/ml-engineer.md` | Specialized |
| `ai-engineer-agentic.md` | `specialized/ai-engineer-agentic.md` | Specialized |
| `web-design-guru.md` | `specialized/web-design-guru.md` | Specialized |
| `project-guru.md` | `specialized/project-guru.md` | Specialized |
| `brd-creator.md` | `specialized/brd-creator.md` | Specialized |

## Breaking Changes

**None** - Migration maintains backward compatibility:
- Cursor folder structure preserved
- Shared resources unchanged
- Open Code agents/commands updated to use Open Code paths
- Both systems can coexist

## Testing Recommendations

1. **Workflow Testing**: Test spec-driven workflow end-to-end:
   - `/specify` → Creates spec folder → Product Strategist → Historian
   - `/plan` → Strategic Architect → Historian
   - `/tasks` → Linear Coordinator → Historian
   - `/implement` → Implementation Specialist → Historian

2. **Orchestrator Testing**: Test orchestrator command:
   - `/orchestrator` → Routes to appropriate agents
   - Multi-agent workflows
   - Governance chain (Context Steward → Agent → Historian)

3. **Reference Validation**: Verify no broken references:
   - No `.cursor/agents/` references in Open Code (except migration docs)
   - All `.opencode/agent/` references use correct category paths
   - Shared resources (`.cursor/specs/`, `.cursor/memory/`, etc.) unchanged

## Files Created/Modified

### Created
- `.opencode/command/orchestrator.md` - Orchestrator command wrapper
- `.opencode/instructions/feature-workflow.md` - Feature workflow documentation
- `.opencode/instructions/workflow-patterns.md` - Workflow patterns documentation
- `.opencode/MIGRATION_NOTES.md` - This file
- `.opencode/MIGRATION_AGENT_MAPPING.md` - Agent mapping documentation
- `.opencode/MIGRATION_COMMAND_MAPPING.md` - Command mapping documentation

### Modified
- `.opencode/agent/orchestrator.md` - Enhanced with conductor patterns
- `.opencode/agent/governance/rule-engineer.md` - Updated conductor references
- `.opencode/agent/specialized/agent-engineer.md` - Updated conductor references
- `.opencode/README.md` - Added orchestrator documentation

## Rollback Plan

If rollback is needed:
1. Cursor folder structure is preserved (no changes made)
2. Git history contains all changes
3. Revert Open Code changes using git:
   ```bash
   git checkout HEAD -- .opencode/
   ```

## Next Steps

1. Test workflows end-to-end
2. Monitor for any reference issues
3. Update team documentation if needed
4. Consider deprecating Cursor conductor.md in favor of orchestrator.md (future)

## Notes

- Migration preserves all Cursor functionality while enhancing Open Code
- Both systems can coexist during transition period
- Shared resources ensure compatibility between systems
- Orchestrator enhancements provide improved workflow orchestration



