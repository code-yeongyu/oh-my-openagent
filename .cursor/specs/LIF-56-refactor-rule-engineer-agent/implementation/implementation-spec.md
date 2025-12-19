# Implementation Specification: LIF-56 Rule Engineer Update

**Date**: 2025-12-17
**Linear Issue**: LIF-56
**Branch**: `hello/lif-56-update-rule-engineer-agent-to-cover-cursor-agents-rules-and`

## Summary

Successfully updated `.opencode/agent/rule-engineer.md` from 217 lines to 466 lines, implementing all 8 phases of the plan.

## Phases Completed

### Phase 1: Fix Outdated References ✅
- Changed title from "Agent Engineer" to "Rule Engineer"
- Replaced all custom-modes references with Cursor agents
- Removed subdirectory paths (governance/, planning/, etc.)
- Added OpenCode agents to specialization list
- Organized capabilities into categories (Agent Management, Rule Management, AGENTS.md Management, Validation & Quality)

### Phase 2: Add AGENTS.md Section with Hierarchical Inheritance ✅
- Expanded from 13 to ~86 lines
- Added hierarchical inheritance model (root→child→grandchild)
- Added root AGENTS.md template
- Added directory AGENTS.md template
- Added when to create/update guidance
- Added validation steps

### Phase 3: Expand 5-Layer Validation ✅
- Expanded from 30 to ~66 lines (condensed for efficiency)
- Layer 1: Added specific YAML error patterns and required fields by type
- Layer 2: Added glob match thresholds table (0=CRITICAL, 1-5=WARNING, 6-200=GOOD, 201-1000=WARNING, >1000=CRITICAL)
- Layer 3: Added cross-ref resolution algorithm
- Layer 4: Added size thresholds by type (Rules <500, Agents <800, AGENTS.md <400)
- Layer 5: Added similarity detection methodology

### Phase 4: Add Reasoning Patterns ✅
- Added chain-of-thought for request analysis (~38 lines)
- Added self-reflection checkpoints
- Added debugging patterns
- Added validation failure recovery

### Phase 5: Update Delegation Section ✅
- Separated MANDATORY (context-steward, historian) from OPTIONAL (agent-auditor, documentation-master, code-reviewer)
- Added orchestrator to "invoked by" list

### Phase 6: Enhance Rule References ✅
- Added key insights from each rule management file
- Created table format with Purpose and Key Insight columns
- Added Critical Insights section

### Phase 7: Add DeepWiki Integration Guidance ✅
- Documented when to query sst/opencode
- Documented how to use DeepWiki tools
- Added example queries
- Added priority guidance

### Phase 8: Add OpenCode Agent Coverage ✅
- Documented OpenCode agents at `.opencode/agent/*.md` (FLAT)
- Documented Cursor agents at `.cursor/agents/*.md` (FLAT)
- Added logical categories table (documentation only)
- Noted schema differences between platforms

## Validation Results

| Check | Result | Details |
|-------|--------|---------|
| Line Count | ✅ 466 lines | Target: 450-500 |
| Custom-modes refs | ✅ 0 matches | All removed |
| Subdirectory paths | ✅ 0 matches | All removed |
| YAML Frontmatter | ✅ Valid | Parses correctly |
| All 4 rule files | ✅ 4 references | With key insights |
| DeepWiki integration | ✅ Present | 5 references |
| MANDATORY/OPTIONAL | ✅ Separated | Clear distinction |

## Files Modified

- `.opencode/agent/rule-engineer.md` - Updated from 217 to 466 lines

## Technical Decisions

1. **Condensed validation sections**: Kept content but reduced verbosity to stay within line limit
2. **Preserved backward compatibility**: All existing capabilities retained, only additions made
3. **FLAT structure emphasized**: Multiple references to flat structure for both OpenCode and Cursor agents
4. **Templates included inline**: Root and directory AGENTS.md templates included for easy reference

## Next Steps

1. Call historian for changelog entry
2. Update Linear issue LIF-56 to "In Review"
