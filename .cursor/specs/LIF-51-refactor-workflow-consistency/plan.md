# Implementation Plan: Workflow Consistency Remediation

**Branch**: `LIF-51-refactor-workflow-consistency` | **Date**: 2025-12-13 | **Spec**: [spec.md](spec.md)

**Note**: This remediation work follows the detailed plan in `.cursor/plans/branch-workflow-review_944a677f.plan.md`. This plan.md serves as a reference to that comprehensive plan.

## Summary

Comprehensive remediation of workflow orchestration inconsistencies across commands, custom agents, rules, templates, and scripts to ensure coherent operation under Linear-only, `.cursor/specs/`-based workflow.

## Constitution Check

✅ **Simplicity-First**: Removing contradictions and broken references simplifies the system  
✅ **Test-First**: Verification gates ensure correctness  
✅ **Documentation Discipline**: All changes tracked via changelog  
✅ **Governance Enforcement**: Context Steward and Historian patterns followed

## Phased Remediation Approach

See `.cursor/plans/branch-workflow-review_944a677f.plan.md` for complete task breakdown:

1. **Phase 0**: Linear tracking & spec folder creation
2. **Phase 1**: Remove Jira from canonical workflow
3. **Phase 2**: Make `speckit.*` legacy commands safe
4. **Phase 3**: Repair cross-references (rules/templates)
5. **Phase 4**: Migrate legacy `specs/` into `.cursor/specs/`
6. **Phase 5**: Fix validation tooling
7. **Phase 6**: Verification gates

## Technical Context

**Project Type**: Workflow orchestration system (agentic development workflow)  
**Scope**: Documentation, scripts, templates, custom agents, commands  
**Dependencies**: Linear MCP integration, bash scripts, Python validation scripts  
**Constraints**: Must maintain backward compatibility where possible, archive deprecated components

## Project Structure

### Documentation (this feature)

```text
.cursor/specs/LIF-51-refactor-workflow-consistency/
├── spec.md              # Feature specification
├── plan.md              # This file (reference to main plan)
├── tasks.md             # Task breakdown (reference to main plan tasks)
├── status.md            # Feature status tracking
└── changelog/           # Feature changelog entries
```

### Source Code (repository root)

```text
.cursor/
├── commands/            # Command definitions (speckit.*, canonical)
├── agents/        # Mode definitions (jira-coordinator → archive)
├── rules/               # Rule definitions (fix broken references)
├── templates/           # Template files (fix broken references)
├── scripts/             # Bash scripts (update paths)
└── specs/               # Feature specs (migrate from top-level specs/)

Root scripts:
├── extract_agent_paths.py    # Update to extract .cursor/specs/
├── build_structure.py        # Update path classification
└── generate_outputs.py      # Update report language
```

## Implementation Notes

- All tasks are single-purpose and sequential where dependencies exist
- Archive deprecated components rather than deleting (preserve history)
- Update references incrementally to avoid breaking intermediate states
- Run verification gates after each phase

