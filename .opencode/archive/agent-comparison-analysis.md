# Agent Comparison Analysis: Cursor vs Open Code

## Key Patterns in Cursor Agents That Need Merging

### 1. PRE-FLIGHT PATH CHECK (MANDATORY)
**Pattern**: All Cursor agents call Context Steward BEFORE creating folders
**Status**: Some Open Code agents have this, but not consistently
**Action**: Add to all agents that create files

### 2. CALL HISTORIAN (MANDATORY)
**Pattern**: All Cursor agents call Historian AFTER completing work
**Status**: Open Code agents don't consistently have this
**Action**: Add changelog entry creation to all agents

### 3. Command-Driven Invocation Patterns
**Pattern**: Cursor agents handle SPEC_DIR from commands
**Status**: Some Open Code agents have this, need verification
**Action**: Ensure all agents handle command-provided paths

### 4. References to Shared Resources
**Pattern**: `.cursor/specs/`, `.cursor/memory/`, `.cursor/templates/`
**Status**: Need to verify all agents reference these correctly
**Action**: Audit and update references

### 5. Agent File References
**Pattern**: Cursor agents reference `.cursor/agents/{agent}.md`
**Status**: Need to update to `.opencode/agent/{category}/{agent}.md`
**Action**: Update all internal agent references

## Agent-by-Agent Comparison Status

### Governance Agents

| Agent | Cursor Lines | Open Code Lines | Key Differences | Status |
|-------|--------------|-----------------|------------------|--------|
| context-steward | 192 | 107 | Cursor has more detailed validation, examples, memory file validation | ⚠️ Needs merge |
| historian | 197 | 163 | Cursor uses markdown changelogs, Open Code uses git commits | ⚠️ Different approaches |
| agent-auditor | ? | ? | Need comparison | ⏳ Pending |
| meta-improvement-analyst | ? | ? | Need comparison | ⏳ Pending |
| mode-auditor | ? | ? | Need comparison | ⏳ Pending |
| rule-engineer | ? | ? | Already updated conductor refs | ✅ Updated |

### Planning Agents

| Agent | Cursor Lines | Open Code Lines | Key Differences | Status |
|-------|--------------|-----------------|------------------|--------|
| product-strategist | 163 | 292 | Open Code has dual workflow, Cursor has more spec-driven patterns | ⚠️ Needs merge |
| strategic-architect | 163 | 347 | Open Code has dual workflow, Cursor has more detailed steps | ⚠️ Needs merge |
| linear-coordinator | 220 | 542 | Open Code more comprehensive, Cursor has specific patterns | ⚠️ Needs merge |

### Implementation Agents

| Agent | Cursor Lines | Open Code Lines | Key Differences | Status |
|-------|--------------|-----------------|------------------|--------|
| implementation-specialist | 149 | 486 | Cursor has PRE-FLIGHT + HISTORIAN, Open Code more comprehensive | ⚠️ Needs merge |
| quick-fixer | ? | ? | Need comparison | ⏳ Pending |
| devops-specialist | ? | ? | Need comparison | ⏳ Pending |

### Quality Agents

| Agent | Cursor Lines | Open Code Lines | Key Differences | Status |
|-------|--------------|-----------------|------------------|--------|
| code-reviewer | ? | ? | Need comparison | ⏳ Pending |
| test-engineer | ? | ? | Need comparison | ⏳ Pending |
| documentation-master | ? | ? | Need comparison | ⏳ Pending |
| chat-auditor | 1165 | ~142 | Cursor much more comprehensive | ⚠️ Needs merge |

### Specialized Agents

| Agent | Cursor Lines | Open Code Lines | Key Differences | Status |
|-------|--------------|-----------------|------------------|--------|
| rag-architect | ? | ? | Need comparison | ⏳ Pending |
| ml-engineer | ? | ? | Need comparison | ⏳ Pending |
| ai-engineer-agentic | ? | 217 | Need comparison | ⏳ Pending |
| web-design-guru | ? | ? | Need comparison | ⏳ Pending |
| project-guru | ? | ? | Need comparison | ⏳ Pending |
| brd-creator | ? | ? | Need comparison | ⏳ Pending |

## Critical Patterns to Merge

### Pattern 1: PRE-FLIGHT PATH CHECK
```markdown
PRE-FLIGHT PATH CHECK (MANDATORY - CALL CONTEXT STEWARD):
0. Validate project path BEFORE creating any folders:
   a. If SPEC_DIR provided by command: Use that path, validate with Context Steward
   b. If no SPEC_DIR provided: Parse user query for project/feature name
   c. Call Context Steward to validate path
   d. Use returned canonical path for ALL file creation
   e. REFUSE to create files if Context Steward refuses path
```

### Pattern 2: CALL HISTORIAN
```markdown
CALL HISTORIAN (MANDATORY):
13. CALL HISTORIAN (MANDATORY):
    - Engage Historian agent to create changelog entry
    - Provide: agent={agent-name}, scope={brief-description}, files created/modified, key decisions
    - Historian creates: changelog/YYYY-MM-DD__{agent-name}__{scope}.md
    - Historian updates: changelog/index.md
```

### Pattern 3: Command-Driven Invocation
```markdown
COMMAND-DRIVEN INVOCATION (When called by workflow commands):
If invoked by `/command` or other workflow command:
   a. Command provides SPEC_DIR path from script JSON output
   b. Command has already validated spec folder exists
   c. **DO NOT re-create spec folder** - use provided SPEC_DIR
   d. **USE existing SPEC_DIR** directly for all file operations
   e. Still call Context Steward for path validation (uses provided SPEC_DIR)
   f. Read artifacts from SPEC_DIR for context
```

### Pattern 4: Input/Output Artifacts
```markdown
INPUT ARTIFACTS:
Read from .cursor/specs/{ISSUE-ID}-{type}-{name}/ to understand requirements and design:
- spec.md - Complete feature specification
- plan.md - Complete implementation plan
- tasks.md - Task breakdown (if exists)

OUTPUT ARTIFACTS:
Create artifacts in validated path:
- .cursor/specs/{ISSUE-ID}-{type}-{name}/{output-folder}/{files}
```

## Merge Strategy

1. **Add PRE-FLIGHT PATH CHECK** to all agents that create files
2. **Add CALL HISTORIAN** to all agents that complete work
3. **Add Command-Driven Invocation** patterns where missing
4. **Update agent references** from `.cursor/agents/` to `.opencode/agent/{category}/`
5. **Preserve Open Code strengths** (dual workflow, project-context.yaml, etc.)
6. **Merge Cursor improvements** (spec-driven patterns, governance integration)

## Priority Order

1. **High Priority**: Governance agents (context-steward, historian) - used by all others
2. **High Priority**: Planning agents (product-strategist, strategic-architect, linear-coordinator) - entry points
3. **Medium Priority**: Implementation agents (implementation-specialist, quick-fixer, devops-specialist)
4. **Medium Priority**: Quality agents (code-reviewer, test-engineer, documentation-master, chat-auditor)
5. **Low Priority**: Specialized agents (rag-architect, ml-engineer, etc.)



