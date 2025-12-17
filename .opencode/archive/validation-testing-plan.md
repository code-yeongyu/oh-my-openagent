# Validation Testing Plan: Cursor Agent Pattern Migration

## Overview

This plan provides comprehensive test scenarios to validate that all migrated Cursor patterns work correctly in Open Code agents.

## Test Categories

### 1. PRE-FLIGHT PATH CHECK Pattern Tests

#### Test 1.1: Context Steward Call Verification
**Objective**: Verify all file-creating agents call Context Steward before creating folders

**Test Steps**:
1. Invoke Product Strategist with new feature request
2. Verify Context Steward is called before spec folder creation
3. Verify canonical path is used for all file operations
4. Verify refusal if Context Steward rejects path

**Expected Results**:
- Context Steward called before folder creation
- Canonical path used for all files
- Proper error handling if path rejected

**Agents to Test**:
- Product Strategist
- Strategic Architect
- Linear Coordinator
- Quick Fixer
- DevOps Specialist
- Documentation Master
- RAG Architect
- ML Engineer
- AI Engineer Agentic
- Web Design Guru
- BRD Creator

#### Test 1.2: SPEC_DIR Handling (Command-Driven)
**Objective**: Verify agents handle SPEC_DIR from commands correctly

**Test Steps**:
1. Run `/specify` command to create spec folder
2. Run `/plan` command (provides SPEC_DIR)
3. Verify agent uses provided SPEC_DIR (doesn't recreate folder)
4. Verify Context Steward still called for validation

**Expected Results**:
- Agent uses provided SPEC_DIR
- No folder recreation
- Context Steward still validates path

**Agents to Test**:
- Product Strategist (`/specify`)
- Strategic Architect (`/plan`)
- Linear Coordinator (`/tasks`)

### 2. CALL HISTORIAN Pattern Tests

#### Test 2.1: Changelog Creation Verification
**Objective**: Verify all work-completing agents call Historian after work

**Test Steps**:
1. Invoke Product Strategist to create requirements
2. Verify Historian is called after spec.md creation
3. Verify changelog entry created in correct format
4. Verify changelog/index.md updated

**Expected Results**:
- Historian called after work completion
- Changelog entry created: `changelog/YYYY-MM-DD__{agent-name}__{scope}.md`
- Index updated chronologically
- Format matches Cursor standard (5-10 lines)

**Agents to Test**:
- Product Strategist
- Strategic Architect
- Linear Coordinator
- Quick Fixer
- DevOps Specialist
- Documentation Master
- RAG Architect
- ML Engineer
- AI Engineer Agentic
- Web Design Guru
- BRD Creator

#### Test 2.2: Changelog Format Compliance
**Objective**: Verify changelog entries match Cursor format exactly

**Test Steps**:
1. Complete work with any agent
2. Verify changelog entry format:
   - Date in YYYY-MM-DD format
   - Agent name matches official list
   - Scope is concise (< 50 chars)
   - Summary is 1-2 sentences max
   - Files list is specific with paths
   - Decisions have rationale
   - Entry is 5-10 lines (not verbose)

**Expected Results**:
- All format requirements met
- Entry is grep-able
- Index updated correctly

### 3. Command-Driven Invocation Pattern Tests

#### Test 3.1: SPEC_DIR Handling
**Objective**: Verify agents handle SPEC_DIR from commands

**Test Steps**:
1. Run `/specify` command (creates spec folder)
2. Run `/plan` command (provides SPEC_DIR)
3. Verify agent:
   - Uses provided SPEC_DIR
   - Doesn't recreate folder
   - Still calls Context Steward for validation
   - Reads artifacts from SPEC_DIR

**Expected Results**:
- SPEC_DIR used correctly
- No folder recreation
- Context Steward still called
- Artifacts read from SPEC_DIR

**Commands to Test**:
- `/specify` → Product Strategist
- `/plan` → Strategic Architect
- `/tasks` → Linear Coordinator
- `/implement` → Implementation Specialist

### 4. Agent Reference Tests

#### Test 4.1: Agent Reference Resolution
**Objective**: Verify all agent references resolve correctly

**Test Steps**:
1. Search for all agent references in Open Code agents
2. Verify all references use `.opencode/agent/{category}/` format
3. Verify no `.cursor/agents/` references remain
4. Verify all referenced agents exist

**Expected Results**:
- All references use correct format
- No old references remain
- All referenced agents exist

#### Test 4.2: Conductor → Orchestrator References
**Objective**: Verify all conductor references updated to orchestrator

**Test Steps**:
1. Search for "Railway Conductor", "conductor", "Conductor" in agents
2. Verify all updated to "Orchestrator", "orchestrator", "Orchestrator"
3. Verify command paths updated

**Expected Results**:
- All conductor references updated
- Command paths updated
- No old references remain

### 5. Shared Resource Tests

#### Test 5.1: Shared Resource Access
**Objective**: Verify shared resources accessible and unchanged

**Test Steps**:
1. Verify `.cursor/specs/` references work
2. Verify `.cursor/memory/` references work
3. Verify `.cursor/templates/` references work
4. Verify `.cursor/scripts/` references work

**Expected Results**:
- All shared resources accessible
- Paths unchanged
- No broken references

### 6. Comprehensive Workflow Tests

#### Test 6.1: Full Feature Workflow
**Objective**: Test complete feature workflow with all patterns

**Test Steps**:
1. Run `/specify` command (Product Strategist)
   - Verify PRE-FLIGHT called
   - Verify spec.md created
   - Verify CALL HISTORIAN
2. Run `/plan` command (Strategic Architect)
   - Verify PRE-FLIGHT with SPEC_DIR
   - Verify plan.md created
   - Verify CALL HISTORIAN
3. Run `/tasks` command (Linear Coordinator)
   - Verify PRE-FLIGHT with SPEC_DIR
   - Verify tasks.md created
   - Verify CALL HISTORIAN
4. Verify all changelog entries created correctly
5. Verify all artifacts in correct locations

**Expected Results**:
- All patterns executed correctly
- All artifacts created in correct locations
- All changelog entries created
- Workflow completes successfully

#### Test 6.2: Emergency Workflow (Quick Fixer)
**Objective**: Test Quick Fixer emergency handling

**Test Steps**:
1. Invoke Quick Fixer for urgent bug fix
2. Verify PRE-FLIGHT (may defer for emergencies)
3. Verify fix implemented
4. Verify CALL HISTORIAN (may be retroactive)
5. Verify changelog entry created

**Expected Results**:
- Emergency handling works correctly
- Retroactive changelog acceptable
- All patterns respected

### 7. Chat Auditor Comprehensive Test

#### Test 7.1: Full Audit Workflow
**Objective**: Test Chat Auditor comprehensive audit workflow

**Test Steps**:
1. Invoke Chat Auditor manually
2. Verify audit scope confirmation
3. Verify conversation history analysis
4. Verify compliance checking (all 13 steps)
5. Verify compliance score calculation
6. Verify findings report generation
7. Verify recommendations prioritization
8. Verify trend analysis (if multiple audits exist)
9. Verify audit artifacts created:
   - `audit-YYYY-MM-DD-HHMMSS.md`
   - `README.md` updated
   - `trends.json` updated

**Expected Results**:
- All 13 steps executed
- Compliance score calculated correctly
- Findings categorized correctly
- Recommendations prioritized
- All artifacts created

## Test Execution Plan

### Phase 1: Pattern Verification (Priority: HIGH)
- [ ] Test 1.1: Context Steward Call Verification
- [ ] Test 1.2: SPEC_DIR Handling
- [ ] Test 2.1: Changelog Creation Verification
- [ ] Test 2.2: Changelog Format Compliance

### Phase 2: Reference Verification (Priority: HIGH)
- [ ] Test 4.1: Agent Reference Resolution
- [ ] Test 4.2: Conductor → Orchestrator References
- [ ] Test 5.1: Shared Resource Access

### Phase 3: Workflow Integration (Priority: MEDIUM)
- [ ] Test 3.1: SPEC_DIR Handling
- [ ] Test 6.1: Full Feature Workflow
- [ ] Test 6.2: Emergency Workflow

### Phase 4: Comprehensive Testing (Priority: MEDIUM)
- [ ] Test 7.1: Chat Auditor Comprehensive Test

## Success Criteria

- ✅ All PRE-FLIGHT patterns execute correctly
- ✅ All CALL HISTORIAN patterns execute correctly
- ✅ All Command-Driven patterns execute correctly
- ✅ All agent references resolve correctly
- ✅ All shared resources accessible
- ✅ All workflows complete successfully
- ✅ Chat Auditor comprehensive audit works

## Test Data Requirements

### Sample Feature
- Feature name: "user-authentication"
- Linear issue: LIF-42 (or sequential: 001)
- Spec folder: `.cursor/specs/LIF-42-feat-user-authentication/`

### Sample Conversation
- Multiple agent invocations
- File creations
- Tool calls
- MCP interactions

## Reporting

After each test:
1. Document results
2. Note any deviations from expected behavior
3. Update test status
4. Report issues for resolution

## Notes

- Tests should be run in order (Phase 1 → Phase 2 → Phase 3 → Phase 4)
- Each test should be independent and repeatable
- Test data should be cleaned up after each test
- Results should be documented for future reference



