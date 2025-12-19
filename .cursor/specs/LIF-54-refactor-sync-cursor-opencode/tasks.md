---
title: Task Breakdown - LIF-54 Sync Cursor and OpenCode
feature_id: LIF-54-refactor-sync-cursor-opencode
date: 2025-12-16
---

# Task Breakdown: LIF-54 Sync Cursor and OpenCode

**Linear Issue**: [LIF-54](https://linear.app/lifelogger/issue/LIF-54/sync-cursor-and-opencode-agentcommandtemplate-directories)  
**Branch**: `hello/lif-54-sync-cursor-and-opencode-agentcommandtemplate-directories`  
**Total Estimated Time**: 11-17 hours  
**Status**: Ready for Implementation

---

## Phase 1: Verify Existing Syncs (P1 - 1-2 hours)

**Goal**: Validate that 5 already-ported commands work correctly in OpenCode and document any issues.

**Success Criteria**:
- 100% pass rate on all 5 commands
- Agent delegation verified working
- Divergence report generated
- spec.md updated with findings

### T001: Test analyze.md Command in OpenCode
- **Estimated Time**: 15 min
- **Task**: Run `/analyze` command in OpenCode CLI; verify output matches Cursor behavior
- **Acceptance Criteria**:
  - [ ] Command executes without errors
  - [ ] Output format matches Cursor version
  - [ ] Agent delegation works correctly
  - [ ] No broken references to agents or tools
- **Dependencies**: None
- **Notes**: First of 5 synced commands to verify

### T002: Test checklist.md Command in OpenCode
- **Estimated Time**: 15 min
- **Task**: Run `/checklist` command in OpenCode CLI; verify functionality
- **Acceptance Criteria**:
  - [ ] Command executes without errors
  - [ ] Checklist template loads correctly
  - [ ] Agent delegation to test-engineer works
  - [ ] Output matches Cursor version
- **Dependencies**: None

### T003: Test clarify.md Command in OpenCode
- **Estimated Time**: 15 min
- **Task**: Run `/clarify` command in OpenCode CLI; verify agent delegation
- **Acceptance Criteria**:
  - [ ] Command executes without errors
  - [ ] Delegates to product-strategist correctly
  - [ ] Agent path resolution works (planning/product-strategist)
  - [ ] Output format consistent with Cursor
- **Dependencies**: None

### T004: Test code-review.md Command in OpenCode
- **Estimated Time**: 15 min
- **Task**: Run `/code-review` command in OpenCode CLI; verify code-reviewer delegation
- **Acceptance Criteria**:
  - [ ] Command executes without errors
  - [ ] Delegates to code-reviewer correctly
  - [ ] Agent path resolution works (quality/code-reviewer)
  - [ ] Review output matches expected format
- **Dependencies**: None

### T005: Test update-context.md Command in OpenCode
- **Estimated Time**: 15 min
- **Task**: Run `/update-context` command in OpenCode CLI; verify memory file updates
- **Acceptance Criteria**:
  - [ ] Command executes without errors
  - [ ] Updates .cursor/memory/ files correctly
  - [ ] File format preserved
  - [ ] No errors in agent delegation
- **Dependencies**: None

### T006: Verify Agent Delegation Patterns
- **Estimated Time**: 20 min
- **Task**: Test delegation from synced commands to agents; verify path resolution
- **Acceptance Criteria**:
  - [ ] All 5 commands delegate to correct agents
  - [ ] Agent paths use categorized format (e.g., governance/context-steward)
  - [ ] No broken agent references
  - [ ] Delegation chain works end-to-end
- **Dependencies**: T001, T002, T003, T004, T005

### T007: Generate Divergence Report
- **Estimated Time**: 30 min
- **Task**: Create detailed report comparing Cursor and OpenCode directories; document all differences
- **Acceptance Criteria**:
  - [ ] Report lists all agents in both directories
  - [ ] Report lists all commands in both directories
  - [ ] Sync status documented for each item
  - [ ] OpenCode-only items clearly marked
  - [ ] Saved to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/divergence-report.md`
- **Dependencies**: T001-T006

### T008: Update spec.md with Phase 1 Findings
- **Estimated Time**: 15 min
- **Task**: Document Phase 1 results in spec.md; update success criteria status
- **Acceptance Criteria**:
  - [ ] All 5 commands verified as working
  - [ ] Issues documented (if any)
  - [ ] Divergence report linked
  - [ ] SC-001 marked complete
- **Dependencies**: T007

---

## Phase 1.5: Fix Flat Agent Structure References (P1 - 1-2 hours) 🆕

**Goal**: Update all OpenCode documentation to use flat agent structure (`.opencode/agent/*.md`) instead of categorized subdirectories.

**Background**: Phase 1 discovered that OpenCode agents are in a FLAT structure, but orchestrator and governance docs reference CATEGORIZED paths (`governance/context-steward`). This must be fixed before proceeding.

**Success Criteria**:
- All agent references use flat naming (e.g., `context-steward` not `governance/context-steward`)
- Governance rules updated to document flat structure
- Translation guide updated
- No broken delegations

### T008.1: Update governance.md Agent Organization Section
- **Estimated Time**: 20 min
- **Task**: Update `.opencode/instructions/governance.md` to document flat agent structure instead of subdirectories
- **Acceptance Criteria**:
  - [ ] Remove subdirectory convention (`governance/`, `planning/`, etc.)
  - [ ] Document flat structure: `.opencode/agent/{agent}.md`
  - [ ] Update agent discovery section
  - [ ] Keep agent categorization as logical grouping (documentation only, not file structure)
- **Dependencies**: T008

### T008.2: Update orchestrator.md Agent References
- **Estimated Time**: 45 min
- **Task**: Replace all categorized agent paths with flat names in orchestrator.md
- **Acceptance Criteria**:
  - [ ] `governance/context-steward` → `context-steward`
  - [ ] `governance/historian` → `historian`
  - [ ] `planning/product-strategist` → `product-strategist`
  - [ ] `planning/strategic-architect` → `strategic-architect`
  - [ ] `planning/linear-coordinator` → `linear-coordinator`
  - [ ] `implementation/implementation-specialist` → `implementation-specialist`
  - [ ] `implementation/quick-fixer` → `quick-fixer`
  - [ ] `implementation/devops-specialist` → `devops-specialist`
  - [ ] `quality/code-reviewer` → `code-reviewer`
  - [ ] `quality/test-engineer` → `test-engineer`
  - [ ] `quality/documentation-master` → `documentation-master`
  - [ ] All `specialized/*` agents → flat names
  - [ ] Verify no categorized paths remain (grep check)
- **Dependencies**: T008.1

### T008.3: Update cursor-opencode-sync.md Translation Guide
- **Estimated Time**: 30 min
- **Task**: Update translation guide to reflect flat agent structure
- **Acceptance Criteria**:
  - [ ] Update Agent Category Mapping table (remove categorized paths)
  - [ ] Update delegation pattern examples
  - [ ] Document that OpenCode uses flat structure
  - [ ] Update sync procedures
- **Dependencies**: T008.1

### T008.4: Verify Flat Agent Resolution
- **Estimated Time**: 15 min
- **Task**: Test that task tool correctly resolves flat agent names
- **Acceptance Criteria**:
  - [ ] `task(subagent_type: "context-steward")` works
  - [ ] `task(subagent_type: "product-strategist")` works
  - [ ] `task(subagent_type: "implementation-specialist")` works
  - [ ] No errors in agent resolution
- **Dependencies**: T008.2, T008.3

### T008.5: Document Phase 1.5 Completion
- **Estimated Time**: 10 min
- **Task**: Update spec.md and status.md with Phase 1.5 results; call Historian
- **Acceptance Criteria**:
  - [ ] Phase 1.5 findings documented
  - [ ] Changelog entry created
  - [ ] Ready for Phase 2
- **Dependencies**: T008.4

---

## Phase 2: Port Medium-Priority Commands (P1 - 2-3 hours)

**Goal**: Port 3 medium-priority commands (sync-linear, create-pr, debug-issue) to OpenCode with full functionality.

**Success Criteria**:
- 3 commands ported and functional
- OpenCode YAML frontmatter added
- All delegation paths corrected
- End-to-end workflows verified

### T009: Port sync-linear.md to OpenCode
- **Estimated Time**: 45 min
- **Task**: Translate sync-linear.md from Cursor to OpenCode format; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/sync-linear.md`
  - [ ] YAML frontmatter added (description, handoffs)
  - [ ] All agent delegations updated to categorized paths
  - [ ] Linear MCP references verified
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T008
- **Notes**: Uses translation guide at `.opencode/instructions/cursor-opencode-sync.md`

### T010: Port create-pr.md to OpenCode
- **Estimated Time**: 45 min
- **Task**: Translate create-pr.md from Cursor to OpenCode format; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/create-pr.md`
  - [ ] YAML frontmatter added (description, handoffs)
  - [ ] All agent delegations updated to categorized paths
  - [ ] GitHub integration verified
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T008
- **Notes**: May reference implementation-specialist or code-reviewer

### T011: Port debug-issue.md to OpenCode
- **Estimated Time**: 45 min
- **Task**: Translate debug-issue.md from Cursor to OpenCode format; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/debug-issue.md`
  - [ ] YAML frontmatter added (description, handoffs)
  - [ ] All agent delegations updated to categorized paths
  - [ ] Debugging workflow verified
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T008
- **Notes**: Likely delegates to implementation-specialist or quick-fixer

### T012: Test Ported Commands End-to-End
- **Estimated Time**: 30 min
- **Task**: Run all 3 ported commands in OpenCode; verify full workflows work correctly
- **Acceptance Criteria**:
  - [ ] `/sync-linear` command executes without errors
  - [ ] `/create-pr` command executes without errors
  - [ ] `/debug-issue` command executes without errors
  - [ ] All agent delegations work correctly
  - [ ] Output matches expected format
- **Dependencies**: T009, T010, T011

### T013: Fix Delegation Paths in Ported Commands
- **Estimated Time**: 20 min
- **Task**: Review all delegation references in ported commands; ensure they use categorized paths
- **Acceptance Criteria**:
  - [ ] All `@Agent-Name` references converted to `task(subagent_type: "category/agent")`
  - [ ] All agent paths use correct categories (governance, planning, implementation, quality, specialized)
  - [ ] No broken references
  - [ ] Verified via test execution
- **Dependencies**: T012

### T014: Document Phase 2 Completion
- **Estimated Time**: 15 min
- **Task**: Update spec.md and status.md with Phase 2 results
- **Acceptance Criteria**:
  - [ ] 3 commands documented as ported
  - [ ] SC-002 marked complete
  - [ ] Any issues documented
  - [ ] Ready for Phase 3
- **Dependencies**: T013

---

## Phase 3: Sync Agent Definitions (P2 - 4-6 hours)

**Goal**: Synchronize 21 shared agents from Cursor to OpenCode; preserve OpenCode format and fix all delegation references.

**Success Criteria**:
- All 21 shared agents synced
- Zero broken delegations
- OpenCode format preserved
- `/specify` and `/implement` workflows verified

### T015: Audit Shared Agents List
- **Estimated Time**: 30 min
- **Task**: Create definitive list of 21 shared agents to sync; verify against spec.md inventory
- **Acceptance Criteria**:
  - [ ] List includes all agents from spec.md Directory Audit
  - [ ] Categorized by type (governance, planning, implementation, quality, specialized)
  - [ ] OpenCode-only agents explicitly excluded
  - [ ] Saved to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/agents-to-sync.md`
- **Dependencies**: T014

### T016: Sync Governance Agents (5 agents)
- **Estimated Time**: 1 hour
- **Task**: Sync context-steward, historian, agent-auditor, meta-improvement-analyst, mode-auditor
- **Acceptance Criteria**:
  - [ ] All 5 agents read from `.cursor/agents/`
  - [ ] Content applied to `.opencode/agent/governance/{agent}.md`
  - [ ] YAML frontmatter preserved
  - [ ] Role/Instructions/Guardrails updated
  - [ ] All delegation references fixed
- **Dependencies**: T015
- **Notes**: Governance agents are critical for workflow; test thoroughly

### T017: Sync Planning Agents (3 agents)
- **Estimated Time**: 45 min
- **Task**: Sync product-strategist, strategic-architect, linear-coordinator
- **Acceptance Criteria**:
  - [ ] All 3 agents read from `.cursor/agents/`
  - [ ] Content applied to `.opencode/agent/planning/{agent}.md`
  - [ ] YAML frontmatter preserved
  - [ ] Role/Instructions/Guardrails updated
  - [ ] All delegation references fixed
- **Dependencies**: T015

### T018: Sync Implementation Agents (3 agents)
- **Estimated Time**: 45 min
- **Task**: Sync implementation-specialist, quick-fixer, devops-specialist
- **Acceptance Criteria**:
  - [ ] All 3 agents read from `.cursor/agents/`
  - [ ] Content applied to `.opencode/agent/implementation/{agent}.md`
  - [ ] YAML frontmatter preserved
  - [ ] Role/Instructions/Guardrails updated
  - [ ] All delegation references fixed
- **Dependencies**: T015

### T019: Sync Quality Agents (4 agents)
- **Estimated Time**: 1 hour
- **Task**: Sync code-reviewer, test-engineer, documentation-master, chat-auditor
- **Acceptance Criteria**:
  - [ ] All 4 agents read from `.cursor/agents/`
  - [ ] Content applied to `.opencode/agent/quality/{agent}.md`
  - [ ] YAML frontmatter preserved
  - [ ] Role/Instructions/Guardrails updated
  - [ ] All delegation references fixed
- **Dependencies**: T015

### T020: Sync Specialized Agents (6 agents)
- **Estimated Time**: 1.5 hours
- **Task**: Sync rag-architect, ml-engineer, ai-engineer-agentic, web-design-guru, project-guru, brd-creator, rule-engineer
- **Acceptance Criteria**:
  - [ ] All 6 agents read from `.cursor/agents/`
  - [ ] Content applied to `.opencode/agent/specialized/{agent}.md`
  - [ ] YAML frontmatter preserved
  - [ ] Role/Instructions/Guardrails updated
  - [ ] All delegation references fixed
- **Dependencies**: T015
- **Notes**: Largest category; can be parallelized

### T021: Fix All Delegation References in Synced Agents
- **Estimated Time**: 1 hour
- **Task**: Review all synced agents; convert all delegation patterns to OpenCode format
- **Acceptance Criteria**:
  - [ ] All `@Agent-Name` references converted to `task(subagent_type: "category/agent")`
  - [ ] All agent paths use correct categories
  - [ ] No broken references
  - [ ] Verified via grep/search
- **Dependencies**: T016, T017, T018, T019, T020

### T022: Verify OpenCode-Only Agents Preserved
- **Estimated Time**: 20 min
- **Task**: Confirm that OpenCode-only agents remain untouched and functional
- **Acceptance Criteria**:
  - [ ] agent-engineer.md exists and unchanged
  - [ ] research.md exists and unchanged
  - [ ] conversation-auditor.md exists and unchanged
  - [ ] orchestrator.md exists and unchanged
  - [ ] All 4 agents functional
- **Dependencies**: T021

### T023: Test `/specify` Workflow in OpenCode
- **Estimated Time**: 30 min
- **Task**: Run `/specify LIF-54` in OpenCode; verify product-strategist delegation works with synced agents
- **Acceptance Criteria**:
  - [ ] `/specify` command executes without errors
  - [ ] product-strategist agent invoked correctly
  - [ ] Agent delegation chain works end-to-end
  - [ ] spec.md created with correct structure
  - [ ] No broken agent references
- **Dependencies**: T022

### T024: Test `/implement` Workflow in OpenCode
- **Estimated Time**: 30 min
- **Task**: Run `/implement LIF-54` in OpenCode; verify implementation-specialist delegation works with synced agents
- **Acceptance Criteria**:
  - [ ] `/implement` command executes without errors
  - [ ] implementation-specialist agent invoked correctly
  - [ ] Agent delegation chain works end-to-end
  - [ ] No broken agent references
  - [ ] Workflow matches Cursor behavior
- **Dependencies**: T023

### T025: Document Phase 3 Completion
- **Estimated Time**: 15 min
- **Task**: Update spec.md and status.md with Phase 3 results
- **Acceptance Criteria**:
  - [ ] All 21 agents documented as synced
  - [ ] SC-003 and SC-004 marked complete
  - [ ] Any issues documented
  - [ ] Ready for Phase 4
- **Dependencies**: T024

---

## Phase 4: Port Low-Priority Commands (P3 - 3-4 hours)

**Goal**: Port remaining 20+ low-priority commands to OpenCode; document intentionally skipped commands.

**Success Criteria**:
- 80%+ of remaining commands ported
- Intentionally skipped commands documented
- All ported commands functional
- Complete inventory created

### T026: Create Low-Priority Commands Porting List
- **Estimated Time**: 20 min
- **Task**: Create prioritized list of remaining commands to port; identify which to skip
- **Acceptance Criteria**:
  - [ ] List includes all commands from spec.md Command Inventory
  - [ ] Prioritized by value/frequency of use
  - [ ] Intentionally skipped commands documented with rationale
  - [ ] Saved to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/commands-to-port.md`
- **Dependencies**: T025

### T027: Port refactor-code.md to OpenCode
- **Estimated Time**: 30 min
- **Task**: Translate refactor-code.md; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/refactor-code.md`
  - [ ] YAML frontmatter added
  - [ ] Delegation paths corrected
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T026

### T028: Port security-audit.md to OpenCode
- **Estimated Time**: 30 min
- **Task**: Translate security-audit.md; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/security-audit.md`
  - [ ] YAML frontmatter added
  - [ ] Delegation paths corrected
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T026

### T029: Port write-unit-tests.md to OpenCode
- **Estimated Time**: 30 min
- **Task**: Translate write-unit-tests.md; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/write-unit-tests.md`
  - [ ] YAML frontmatter added
  - [ ] Delegation paths corrected
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T026

### T030: Port add-documentation.md to OpenCode
- **Estimated Time**: 30 min
- **Task**: Translate add-documentation.md; add YAML frontmatter; fix delegation paths
- **Acceptance Criteria**:
  - [ ] File created at `.opencode/command/add-documentation.md`
  - [ ] YAML frontmatter added
  - [ ] Delegation paths corrected
  - [ ] Command tested in OpenCode CLI
- **Dependencies**: T026

### T031: Port Remaining Low-Priority Commands (Batch)
- **Estimated Time**: 2 hours
- **Task**: Port remaining commands: add-error-handling, address-github-pr-comments, create-command, create-prs-from-branches, discuss, impl-plan, lint-fix, optimize-performance, proceed, run-all-tests-and-fix, try-hard, 1-deep-review-project, speckit.constitution
- **Acceptance Criteria**:
  - [ ] All 13 commands ported to `.opencode/command/`
  - [ ] YAML frontmatter added to each
  - [ ] Delegation paths corrected
  - [ ] Batch tested in OpenCode CLI
  - [ ] No errors in any command
- **Dependencies**: T026
- **Notes**: Can be parallelized; use batch processing

### T032: Document Intentionally Skipped Commands
- **Estimated Time**: 15 min
- **Task**: Document commands not ported with clear rationale
- **Acceptance Criteria**:
  - [ ] conductor.help.md documented as low-value (→ orchestrator.help)
  - [ ] NR-review-pr.md documented as project-specific
  - [ ] Rationale clear for each skipped command
  - [ ] Saved to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/skipped-commands.md`
- **Dependencies**: T031

### T033: Verify All Ported Commands Functional
- **Estimated Time**: 45 min
- **Task**: Test all ported commands in OpenCode; verify no regressions
- **Acceptance Criteria**:
  - [ ] All ported commands execute without errors
  - [ ] Agent delegations work correctly
  - [ ] Output format matches expected
  - [ ] No broken references
  - [ ] 80%+ success rate
- **Dependencies**: T031

### T034: Create Complete Command Inventory
- **Estimated Time**: 20 min
- **Task**: Document final state of all commands (ported, skipped, OpenCode-only)
- **Acceptance Criteria**:
  - [ ] Inventory lists all commands with sync status
  - [ ] Ported commands marked with date
  - [ ] Skipped commands documented with rationale
  - [ ] OpenCode-only commands marked
  - [ ] Saved to `.cursor/specs/LIF-54-refactor-sync-cursor-opencode/command-inventory.md`
- **Dependencies**: T033

### T035: Document Phase 4 Completion
- **Estimated Time**: 15 min
- **Task**: Update spec.md and status.md with Phase 4 results
- **Acceptance Criteria**:
  - [ ] Command porting documented
  - [ ] SC-005 marked complete
  - [ ] Inventory linked
  - [ ] Ready for Phase 5
- **Dependencies**: T034

---

## Phase 5: Documentation & Maintenance (P2 - 1-2 hours)

**Goal**: Update translation guide, create sync checklist, and document OpenCode-only features for sustainable maintenance.

**Success Criteria**:
- Translation guide covers 100% of mappings
- Sync checklist created and ready for use
- OpenCode-only features documented
- Maintenance procedures established

### T036: Review and Update Translation Guide
- **Estimated Time**: 45 min
- **Task**: Review `.opencode/instructions/cursor-opencode-sync.md`; add lessons learned from sync process
- **Acceptance Criteria**:
  - [ ] Guide covers all 21 agent mappings
  - [ ] Delegation pattern examples updated
  - [ ] Path translation rules documented
  - [ ] Lessons learned from Phase 1-4 added
  - [ ] Expanded checklist for future syncs
  - [ ] Examples include actual agent names
- **Dependencies**: T035

### T037: Create Sync Checklist
- **Estimated Time**: 30 min
- **Task**: Create `.cursor/scripts/sync-checklist.md` for future maintenance
- **Acceptance Criteria**:
  - [ ] Checklist covers agent syncing procedure
  - [ ] Checklist covers command porting procedure
  - [ ] Validation steps included
  - [ ] Testing steps included
  - [ ] Ready for reuse on future syncs
- **Dependencies**: T036

### T038: Document OpenCode-Only Features
- **Estimated Time**: 20 min
- **Task**: Update `.opencode/README.md` with OpenCode-specific features and agents
- **Acceptance Criteria**:
  - [ ] agent-engineer agent documented
  - [ ] research agent documented
  - [ ] conversation-auditor agent documented
  - [ ] orchestrator agent documented
  - [ ] init-project command documented
  - [ ] orchestrator command documented
  - [ ] Custom tools documented
- **Dependencies**: T036

### T039: Create Maintenance Procedures Document
- **Estimated Time**: 15 min
- **Task**: Document procedures for maintaining sync going forward
- **Acceptance Criteria**:
  - [ ] Procedure for adding new agents documented
  - [ ] Procedure for updating existing agents documented
  - [ ] Procedure for porting new commands documented
  - [ ] Validation procedures documented
  - [ ] Saved to `.opencode/instructions/sync-maintenance.md`
- **Dependencies**: T038

### T040: Final Verification and Sign-Off
- **Estimated Time**: 30 min
- **Task**: Verify all phases complete; run final end-to-end tests
- **Acceptance Criteria**:
  - [ ] All 5 synced commands verified working
  - [ ] All 3 ported medium-priority commands verified working
  - [ ] All 21 agents synced and verified
  - [ ] 80%+ low-priority commands ported
  - [ ] `/specify` workflow verified
  - [ ] `/implement` workflow verified
  - [ ] No regressions in Cursor workflows
- **Dependencies**: T039

### T041: Update spec.md with Final Status
- **Estimated Time**: 15 min
- **Task**: Update spec.md with final completion status; mark all success criteria complete
- **Acceptance Criteria**:
  - [ ] All SC-001 through SC-006 marked complete
  - [ ] Definition of Done checklist completed
  - [ ] Final status documented
  - [ ] Ready for Linear update
- **Dependencies**: T040

### T042: Create Linear Comment with Summary
- **Estimated Time**: 15 min
- **Task**: Add comment to LIF-54 with architecture summary and plan link
- **Acceptance Criteria**:
  - [ ] Comment includes brief architecture summary
  - [ ] Links to plan.md and spec.md
  - [ ] Links to all created documentation
  - [ ] Completion status clear
  - [ ] Ready for Historian
- **Dependencies**: T041

### T043: Call Historian for Changelog Entry
- **Estimated Time**: 15 min
- **Task**: Engage Historian agent to create changelog entry
- **Acceptance Criteria**:
  - [ ] Historian called with scope: "LIF-54 sync cursor-opencode"
  - [ ] Changelog entry created: `changelog/YYYY-MM-DD__linear-coordinator__lif-54-sync-cursor-opencode.md`
  - [ ] changelog/index.md updated
  - [ ] Entry includes all phases and outcomes
- **Dependencies**: T042

---

## Task Dependencies Summary

```
Phase 1 (T001-T008):
  T001 → T006 → T007 → T008
  T002 → T006
  T003 → T006
  T004 → T006
  T005 → T006

Phase 2 (T009-T014):
  T008 → T009 → T012 → T013 → T014
  T008 → T010 → T012 → T013 → T014
  T008 → T011 → T012 → T013 → T014

Phase 3 (T015-T025):
  T014 → T015 → T016 → T021 → T022 → T023 → T024 → T025
  T015 → T017 → T021
  T015 → T018 → T021
  T015 → T019 → T021
  T015 → T020 → T021

Phase 4 (T026-T035):
  T025 → T026 → T027 → T033 → T034 → T035
  T026 → T028 → T033
  T026 → T029 → T033
  T026 → T030 → T033
  T026 → T031 → T032 → T033

Phase 5 (T036-T043):
  T035 → T036 → T037 → T038 → T039 → T040 → T041 → T042 → T043
```

---

## Parallelization Opportunities

**Can be parallelized**:
- T001-T005 (testing 5 synced commands) - independent
- T016-T020 (syncing agent categories) - independent after T015
- T027-T031 (porting low-priority commands) - independent after T026

**Sequential requirements**:
- Phase 1 must complete before Phase 2
- Phase 2 must complete before Phase 3
- Phase 3 must complete before Phase 4
- Phase 4 must complete before Phase 5

---

## Time Estimates by Phase

| Phase | Min Hours | Max Hours | Tasks |
|-------|-----------|-----------|-------|
| Phase 1 | 1.0 | 2.0 | T001-T008 (8 tasks) |
| Phase 2 | 2.0 | 3.0 | T009-T014 (6 tasks) |
| Phase 3 | 4.0 | 6.0 | T015-T025 (11 tasks) |
| Phase 4 | 3.0 | 4.0 | T026-T035 (10 tasks) |
| Phase 5 | 1.0 | 2.0 | T036-T043 (8 tasks) |
| **TOTAL** | **11.0** | **17.0** | **43 tasks** |

---

## Success Metrics

- [ ] All 43 tasks completed
- [ ] 100% pass rate on Phase 1 verification
- [ ] 3+ medium-priority commands ported (Phase 2)
- [ ] 21 agents synced (Phase 3)
- [ ] 80%+ low-priority commands ported (Phase 4)
- [ ] Translation guide updated (Phase 5)
- [ ] Sync checklist created (Phase 5)
- [ ] Zero broken delegations in OpenCode
- [ ] `/specify` and `/implement` workflows verified
- [ ] Historian changelog entry created

---

## Notes

- **Source of Truth**: Cursor agents/commands are source-of-truth for shared content
- **Format Preservation**: OpenCode YAML frontmatter and categorization preserved during sync
- **Testing**: Each phase includes verification steps; no assumptions
- **Documentation**: All decisions and issues documented in spec.md and status.md
- **Maintenance**: Translation guide and sync checklist enable sustainable future syncs

---

**Last Updated**: 2025-12-16  
**Created By**: Linear Coordinator  
**Status**: Ready for Implementation
