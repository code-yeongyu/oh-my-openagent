export const CREDIT_CHANGE_PLAN_TEMPLATE = `## Credit Change Plan Structure

Generate Change Plan to: \`.agentic-loop/plans/{name}.md\`

Use this format for feature implementation planning consumed by Execution Agent:

\`\`\`markdown
# Change Plan: {Feature Name}

## Overview
**Purpose**: [1-2 sentences describing the feature]
**Scope**: [What's included and explicitly excluded]
**Acceptance Criteria**: [How we know it's done]

---

## Files to Modify

<!-- List ALL files: existing (modify), new (create), obsolete (delete) -->

### Create
- [ ] \`{path/to/new-file.ts}\` - [Purpose and responsibility]

### Modify  
- [ ] \`{path/to/existing.ts}\` - [Specific changes needed]
  - Lines {X-Y}: [What to change]
  - Add: [new function/class]
  - Update: [existing logic]

### Delete
- [ ] \`{path/to/obsolete.ts}\` - [Reason for removal, what replaces it]

**Pattern References** (from explore agent findings):
- Follow pattern in \`{existing-file.ts:lines}\` for [specific pattern]
- Use naming convention: [convention from codebase]

---

## APIs and Services

### New Endpoints
- \`{METHOD} {/api/endpoint}\`
  - Purpose: [what it does]
  - Request: [JSON schema or TypeScript interface]
  - Response: [JSON schema or TypeScript interface]
  - Auth: [requirements]

### Updated Endpoints
- \`{METHOD} {/api/existing}\`
  - Change: [what's modified]
  - Backward Compatible: [YES/NO]

### Service Layer Changes
- \`{ServiceName}.{method}()\`
  - Location: \`{src/services/...}\`
  - Logic: [description]
  - Dependencies: [other services/modules]

---

## Database Changes

### Schema Migrations
\`\`\`sql
-- Migration: {YYYYMMDDHHMMSS}_description.sql
-- Purpose: [what this migration does]

[SQL statements]
\`\`\`

### Seed Data
\`\`\`sql
-- Required seed data for testing
INSERT INTO {table} ...
\`\`\`

### Data Backfill (if applicable)
- [ ] Script: \`{scripts/backfill.ts}\`
- Records affected: [estimated count]
- Rollback strategy: [how to undo]

---

## Test Flows

### Flow 1: {Happy Path Name}
**Preconditions**: [setup required]
**Steps**:
1. [Specific action with exact data]
2. [Next action]
3. [Expected intermediate state]
**Expected Outcome**: [concrete, verifiable result]
**Evidence**: [how to capture success]

### Flow 2: {Error Scenario Name}
**Preconditions**: [error condition setup]
**Steps**:
1. [Trigger error action]
2. [Assert error handling]
**Expected Outcome**: [graceful error response]
**Evidence**: [error log/assertion]

### Flow 3: {Edge Case Name}
**Preconditions**: [edge case conditions]
**Steps**:
1. [Edge case action]
**Expected Outcome**: [correct handling]

---

## Risk Areas

| Area | Risk Level | Description | Mitigation |
|------|-----------|-------------|------------|
| {Area} | High/Med/Low | {Specific risk} | {How to prevent/handle} |

### Rollback Strategy
If issues detected:
1. [Step 1 to rollback]
2. [Step 2]
3. [Verification rollback succeeded]

---

## Validation Steps

### Pre-Implementation
- [ ] {Check before starting}

### Post-Implementation
- [ ] \`{command to verify}\` → Expected: {output}
- [ ] {File} exists and contains {pattern}
- [ ] API returns {status code} with {response structure}
- [ ] Database has {expected state}

### Integration Verification
- [ ] {Integration test command}
- [ ] {E2E verification step}

---

## Dependencies

### External
- {Service/Library}: [version, why needed]

### Internal  
- {Module/Service}: [what it provides]
- Blocked by: [prerequisite work]

---

## Notes

### Assumptions
- [Assumption 1]: [Basis]
- [Assumption 2]: [Basis]

### Open Questions
- [ ] {Question}: {Context}

### References
- Design doc: {link}
- Related PR: {link}
- Slack thread: {link}
\`\`\`
`

export const CREDIT_CHANGE_PLAN_SECTIONS = {
  overview: `## Overview
Brief description of the feature:
- What problem does it solve?
- What is the desired outcome?
- What are the acceptance criteria?`,

  filesToModify: `## Files to Modify
List every file with specific changes:
- Create: New files with purpose
- Modify: Existing files with line ranges and change descriptions
- Delete: Obsolete files with replacement rationale
- Pattern references: Existing code patterns to follow`,

  apisAndServices: `## APIs and Services
Document all API changes:
- New endpoints: Method, path, request/response schemas, auth
- Updated endpoints: Changes made, backward compatibility
- Service layer: New methods, logic changes, dependencies`,

  databaseChanges: `## Database Changes
If applicable:
- Schema migrations with SQL
- Seed data for testing
- Data backfill requirements and rollback`,

  testFlows: `## Test Flows
Define testable scenarios:
- Happy path with exact steps and expected outcomes
- Error scenarios with graceful handling
- Edge cases with specific conditions`,

  riskAreas: `## Risk Areas
Identify and mitigate:
- Breaking changes
- Performance impacts
- Security considerations
- Rollback strategy`,

  validationSteps: `## Validation Steps
Verification checklist:
- Pre-implementation checks
- Post-implementation verification commands
- Integration testing`,
}
