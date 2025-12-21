# Test Plan: LIF-69 OmO Delegation Optimization

**Feature**: OmO Delegation Optimization (Cost Reduction + Enforcement)
**Branch**: `hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement`
**Date**: 2025-12-20
**Status**: Manual Testing Required

---

## Overview

This test plan covers verification of LIF-69 implementation. Since the project has no automated test framework configured, all tests are manual verification scenarios.

---

## Testing Constraints

| Constraint | Impact |
|------------|--------|
| No test framework configured | All tests are manual |
| No unit test runner | Cannot verify individual functions in isolation |
| Runtime testing required | Must use OpenCode CLI to verify behavior |

---

## Test Scope

### In Scope
- ✅ P0 Critical Requirements (FR-001 through FR-006)
- ✅ Non-functional requirements (NFR-001, NFR-003)
- ✅ User Stories 1-2 acceptance scenarios
- ✅ Type safety and build verification

### Out of Scope
- ❌ P1/P2 features (deferred per tasks.md)
- ❌ Performance benchmarking (requires telemetry infrastructure)
- ❌ Automated regression testing (no framework)

---

## Prerequisites

```bash
# 1. Ensure oh-my-opencode is installed
opencode --version  # Should be >=1.0.132

# 2. Verify plugin is loaded
cat ~/.config/opencode/opencode.json | grep oh-my-opencode

# 3. Enable governance features
cat > ~/.config/opencode/oh-my-opencode.json <<'EOF'
{
  "governance": {
    "docs_blocking": {
      "enabled": true,
      "mode": "block"
    },
    "artifact_truncation": {
      "enabled": true,
      "max_summary_tokens": 200,
      "max_output_chars": 4000,
      "keep_task_metadata": true
    }
  }
}
EOF

# 4. Checkout branch
git checkout hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement
```

---

## Test Suite

### TS-001: Type Safety & Build Verification

**Purpose**: Verify implementation compiles without errors

**Type**: Static Analysis

**Steps**:
```bash
cd /Users/eru/Documents/GitHub/oh-my-opencode

# 1. Type check
bun run typecheck

# 2. Build
bun run build

# 3. Verify dist/ output exists
ls -la dist/
```

**Expected Results**:
- ✅ `bun run typecheck` exits with code 0
- ✅ `bun run build` exits with code 0
- ✅ `dist/index.js` and `dist/index.d.ts` exist

**Actual Results**: ✅ PASSED (verified in review phase)

---

### TS-002: Documentation BLOCKING Gate (Path-Based)

**Purpose**: Verify FR-001, FR-002 - Documentation files trigger BLOCKING

**Type**: Integration Test

**Related User Story**: US-002 Scenario 1

**Setup**:
```bash
# Create test project with README
mkdir -p /tmp/lif-69-test
cd /tmp/lif-69-test
git init
echo "# Test Project" > README.md
git add .
git commit -m "initial"

# Start opencode session
opencode
```

**Test Cases**:

#### TC-002.1: Block README.md edit (Non-document-writer)

**Steps**:
1. Prompt: "Edit README.md to add a new section"
2. Observe if OmO attempts direct edit or delegates

**Expected**:
- ⚠️ If OmO attempts direct edit → Hook throws error with message:
  ```
  [Governance] Operation blocked: Documentation changes must be delegated to document-writer.
  Path: README.md
  Remediation: task(subagent_type="document-writer", prompt="Write/update README.md")
  ```

**Verification Points**:
- [ ] Error message includes path
- [ ] Error message includes remediation with delegation syntax
- [ ] File is NOT modified

#### TC-002.2: Block docs/** edit

**Steps**:
1. Create `docs/api.md`
2. Prompt: "Update docs/api.md with new endpoint"

**Expected**:
- BLOCKED with same error format

#### TC-002.3: Block CHANGELOG.md edit

**Steps**:
1. Create `CHANGELOG.md`
2. Prompt: "Add entry to CHANGELOG.md for version 1.0.0"

**Expected**:
- BLOCKED

#### TC-002.4: Block .md file in subdirectory

**Steps**:
1. Create `src/components/Button.md`
2. Prompt: "Update src/components/Button.md with usage examples"

**Expected**:
- BLOCKED (matches `**/*.md` pattern)

---

### TS-003: Documentation BLOCKING Exceptions

**Purpose**: Verify actors and paths can bypass BLOCKING

**Type**: Integration Test

**Related**: FR-001 exception handling

#### TC-003.1: Allow document-writer agent

**Steps**:
1. Prompt: "Delegate to document-writer to update README.md"
2. OmO calls `task(subagent_type="document-writer", ...)`
3. document-writer attempts edit

**Expected**:
- ✅ Edit succeeds without BLOCKING
- ✅ File is modified

**Verification**:
- [ ] No governance error thrown
- [ ] Changes written to file

#### TC-003.2: Allow spec folder edits

**Steps**:
1. Create `.cursor/specs/TEST-001-feat-test/spec.md`
2. Prompt: "Update the spec.md file"

**Expected**:
- ✅ Edit allowed (spec folders excepted)

---

### TS-004: Artifact-Based Returns (Truncation)

**Purpose**: Verify FR-004, FR-005, FR-006 - Specialist returns ≤200 tokens

**Type**: Integration Test

**Related User Story**: US-001 Scenario 1

#### TC-004.1: Large specialist output truncated

**Setup**:
```bash
# Create verbose task that would generate large output
cat > test-large-output.js <<'EOF'
// File with 100 lines of code
function example() {
  // ... (100 lines)
}
EOF
```

**Steps**:
1. Prompt: "Use implementation-specialist to analyze test-large-output.js and suggest improvements"
2. Wait for delegation to complete
3. Observe returned output length

**Expected**:
- Response format:
  ```
  **Status**: success
  
  **Summary**: [≤200 tokens summary]
  
  **Files Changed**:
  - test-large-output.js
  
  **Warnings**: []
  
  **Next Steps**: []
  
  *Note: Response was truncated for cost optimization.*
  
  <task_metadata>
  session_id: ses_...
  </task_metadata>
  ```

**Verification Points**:
- [ ] Summary section ≤800 chars (200 tokens × 4)
- [ ] Status field present
- [ ] filesChanged array present
- [ ] Truncation note shown if content was large
- [ ] task_metadata preserved

#### TC-004.2: Small output not truncated

**Steps**:
1. Prompt: "Use explore agent to find all TypeScript files"
2. Wait for delegation

**Expected**:
- Summary naturally ≤200 tokens
- No truncation note
- Same envelope format

---

### TS-005: Artifact Schema Validation

**Purpose**: Verify FR-005 - Response includes all required fields

**Type**: Integration Test

**Steps**:
1. Trigger any delegation (e.g., explore, librarian)
2. Capture response
3. Parse response structure

**Expected Schema**:
```
{
  "schemaVersion": "1.0",
  "status": "success" | "partial" | "error",
  "summary": string (≤200 tokens),
  "filesChanged": string[],
  "warnings": string[],
  "nextSteps": string[],
  "artifacts": Array<{
    "path": string,
    "kind": "file" | "diff" | "log" | "report" | "link",
    "description": string
  }>,
  "telemetry": {
    "traceId": string,
    "sessionId": string,
    "fromAgent": string,
    "toAgent": string,
    "inputChars": number,
    "outputChars": number,
    "truncated": boolean
  }
}
```

**Verification Points**:
- [ ] All required fields present
- [ ] Types match schema
- [ ] telemetry.truncated reflects truncation state

---

### TS-006: Mixed Task Splitting

**Purpose**: Verify US-002 Scenario 3 - Code changes allowed, docs blocked

**Type**: Integration Test

**Steps**:
1. Prompt: "Fix the bug in auth.ts AND update the README with the fix"
2. Observe OmO behavior

**Expected**:
- OmO handles auth.ts fix (or delegates to implementation-specialist)
- README update triggers BLOCKING or automatic delegation to document-writer
- Both tasks complete successfully

**Verification**:
- [ ] Code change applied
- [ ] Documentation change delegated or blocked
- [ ] No errors from incorrect blocking

---

### TS-007: Configuration Validation

**Purpose**: Verify config schema and defaults

**Type**: Static Test

**Steps**:
```bash
# 1. Check schema exports
bun run build
node -e "const s = require('./dist/index.js'); console.log(s.GovernanceDocsBlockingConfig)"

# 2. Test config with invalid values
cat > /tmp/test-config.json <<'EOF'
{
  "governance": {
    "docs_blocking": {
      "enabled": true,
      "mode": "invalid"
    }
  }
}
EOF

# 3. Validate against schema
# (Would require loading schema validator)
```

**Expected**:
- Schema exports `GovernanceDocsBlockingConfig`
- Invalid mode value rejected by Zod

---

### TS-008: Performance Verification

**Purpose**: Verify NFR-001 - Hook adds <50ms latency

**Type**: Performance Test

**Method**: Manual observation (no profiling tools)

**Steps**:
1. Trigger 10 write operations to non-docs files (should not block)
2. Observe response time
3. Trigger 10 write operations to docs files (should block)
4. Observe blocking time

**Expected**:
- Non-docs writes: No perceptible delay
- Docs writes: Blocking error returned immediately (<50ms)

**Note**: Precise measurement requires instrumentation not available

---

## Acceptance Criteria Testing

### User Story 1: Cost-Conscious Developer

| Scenario | Test Case | Status |
|----------|-----------|--------|
| Artifact-based delegation return | TC-004.1 | Manual |
| Cost tracking per delegation | Not testable (no telemetry UI) | N/A |

### User Story 2: Documentation Task Delegation

| Scenario | Test Case | Status |
|----------|-----------|--------|
| BLOCKING on file path | TC-002.1, TC-002.2, TC-002.3 | Manual |
| BLOCKING on intent keywords | Deferred to P1 | N/A |
| Mixed task splits | TS-006 | Manual |
| User explicit override | Deferred to P1 | N/A |

---

## Edge Cases

### EC-001: Path Traversal Attempt

**Scenario**: User tries `../../etc/passwd`

**Expected**: Path normalization prevents escape

**Test**: Create prompt with traversal path, verify block logic

### EC-002: Symlink Following

**Scenario**: README.md is symlink to allowed file

**Expected**: Real path checked, not symlink

**Note**: Requires `realpath` check (not implemented in v1)

### EC-003: Large File List in filesChanged

**Scenario**: Specialist changes 100 files

**Expected**: Array truncated to reasonable size

**Verification**: Check truncation logic in `truncateArtifactResponse()`

---

## Regression Checks

### RC-001: Existing Functionality Unaffected

**Verify**:
- [ ] Non-governance workflows work (explore, librarian, oracle)
- [ ] Background tasks still function
- [ ] LSP tools unaffected
- [ ] Other hooks still execute

### RC-002: Backward Compatibility

**Verify**:
- [ ] Config with `docs_blocking.enabled: false` disables feature
- [ ] Config without governance section uses defaults
- [ ] Existing agents (non-document-writer) work normally

---

## Test Results Summary

| Test Suite | Total | Passed | Failed | Skipped | Notes |
|------------|-------|--------|--------|---------|-------|
| TS-001 Type Safety | 3 | 3 | 0 | 0 | ✅ Automated |
| TS-002 Docs BLOCKING | 4 | - | - | - | 🔧 Manual required |
| TS-003 Exceptions | 2 | - | - | - | 🔧 Manual required |
| TS-004 Truncation | 2 | - | - | - | 🔧 Manual required |
| TS-005 Schema | 1 | - | - | - | 🔧 Manual required |
| TS-006 Mixed Tasks | 1 | - | - | - | 🔧 Manual required |
| TS-007 Config | 1 | - | - | - | 🔧 Manual required |
| TS-008 Performance | 1 | - | - | - | 🔧 Manual required |

---

## Known Limitations

1. **No Automated Tests**: Project has no test framework
2. **Manual Verification Only**: All tests require OpenCode CLI runtime
3. **No Performance Profiling**: Cannot measure exact latency
4. **No Telemetry Validation**: Cost tracking not visible without instrumentation

---

## Recommendations

### Immediate
1. Run manual test suite before merge
2. Document any deviations from expected behavior

### Future (Post-Merge)
1. Set up test framework (Bun Test or Vitest)
2. Add unit tests for:
   - `isDocsPath()` pattern matching
   - `truncateArtifactResponse()` truncation logic
   - Path normalization
3. Add integration tests using OpenCode test harness
4. Add performance benchmarks with `console.time()`

---

## Test Execution Log

### Execution 1: 2025-12-20

**Tester**: Automated (OmO)
**Environment**: Development
**Branch**: `hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement`

**Completed**:
- ✅ TS-001: Type Safety & Build - All passed

**Pending**:
- 🔧 TS-002 through TS-008: Require runtime OpenCode session

**Blockers**: None

**Notes**:
- Static analysis complete and clean
- Runtime tests require manual execution with OpenCode CLI
- No automated test infrastructure available
