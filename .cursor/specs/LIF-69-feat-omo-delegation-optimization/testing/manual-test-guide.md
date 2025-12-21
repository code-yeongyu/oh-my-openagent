# Manual Test Execution Guide

**Feature**: LIF-69 OmO Delegation Optimization
**Date**: 2025-12-20

---

## Quick Start

This guide provides step-by-step commands for manual verification of LIF-69 functionality.

---

## Setup

```bash
# 1. Install oh-my-opencode with LIF-69 branch
cd ~/.config/opencode
bun add oh-my-opencode@code-yeongyu/oh-my-opencode#hello/lif-69-omo-delegation-optimization-cost-reduction-enforcement

# 2. Configure governance features
cat > oh-my-opencode.json <<'EOF'
{
  "governance": {
    "docs_blocking": {
      "enabled": true,
      "mode": "block"
    },
    "artifact_truncation": {
      "enabled": true,
      "max_summary_tokens": 200,
      "max_output_chars": 4000
    }
  }
}
EOF

# 3. Verify installation
opencode --version
```

---

## Test 1: Documentation BLOCKING (README.md)

### Expected: Direct README edit is blocked

```bash
# Create test project
mkdir -p /tmp/lif-69-test && cd /tmp/lif-69-test
git init
echo "# Test" > README.md
git add . && git commit -m "init"

# Start OpenCode
opencode
```

**Prompt**:
```
Edit README.md to add a "Features" section with bullet points
```

**Expected Behavior**:
- 🚫 OmO attempts to edit → Hook throws error
- ✅ Error message shows:
  ```
  [Governance] Operation blocked: Documentation changes must be delegated to document-writer.
  Path: README.md
  Remediation: task(subagent_type="document-writer", prompt="Write/update README.md")
  ```

**Alternative Expected**:
- ✅ OmO recognizes docs task → Delegates to document-writer automatically
- ✅ document-writer edits successfully

---

## Test 2: Documentation BLOCKING (docs/)

**Prompt**:
```
Create docs/api.md with API documentation
```

**Expected**:
- 🚫 BLOCKED if OmO tries direct write
- ✅ Delegated to document-writer if recognized

---

## Test 3: Spec Folder Exception

**Prompt**:
```
Create .cursor/specs/TEST-001-feat-test/spec.md with requirements
```

**Expected**:
- ✅ ALLOWED (spec folders are excepted)
- ✅ File created successfully

---

## Test 4: Artifact Truncation (Large Output)

**Setup**:
```bash
# Create file with verbose content
cat > verbose-analysis.ts <<'EOF'
// 100 lines of code
export function analyzeData() {
  // ... complex logic
}
EOF
```

**Prompt**:
```
Use implementation-specialist to analyze verbose-analysis.ts and provide detailed code review with suggestions
```

**Expected Response Format**:
```
**Status**: success

**Summary**: [Brief summary ≤800 chars]

**Files Changed**:
- verbose-analysis.ts

**Warnings**: []

**Next Steps**:
- [Suggestions]

*Note: Response was truncated for cost optimization.*

<task_metadata>
session_id: ses_...
</task_metadata>
```

**Verification**:
- [ ] Summary is concise (≤800 characters)
- [ ] Includes all required fields
- [ ] Truncation note present if content was large

---

## Test 5: Mixed Task (Code + Docs)

**Setup**:
```bash
cat > auth.ts <<'EOF'
export function login(user: string) {
  // Bug: no password check
  return true;
}
EOF

echo "# Auth Module" > README.md
```

**Prompt**:
```
Fix the bug in auth.ts (add password validation) AND update README.md to document the fix
```

**Expected**:
- ✅ auth.ts fix handled (direct or delegated to implementation-specialist)
- 🚫 README.md update blocked OR delegated to document-writer
- ✅ Both tasks complete successfully

---

## Test 6: document-writer Bypass

**Prompt**:
```
Delegate to document-writer: Update README.md with installation instructions
```

**Expected**:
- ✅ OmO calls `task(subagent_type="document-writer", ...)`
- ✅ document-writer edits README.md without blocking
- ✅ Changes written successfully

---

## Test 7: Configuration Toggle

### Test 7a: Disable docs blocking

```bash
# Update config
cat > ~/.config/opencode/oh-my-opencode.json <<'EOF'
{
  "governance": {
    "docs_blocking": {
      "enabled": false
    }
  }
}
EOF

# Restart OpenCode session
```

**Prompt**:
```
Edit README.md to add a new section
```

**Expected**:
- ✅ Edit succeeds without blocking
- ✅ Feature is disabled

### Test 7b: Warn mode

```bash
cat > ~/.config/opencode/oh-my-opencode.json <<'EOF'
{
  "governance": {
    "docs_blocking": {
      "enabled": true,
      "mode": "warn"
    }
  }
}
EOF
```

**Prompt**: Same as above

**Expected**:
- ⚠️ Warning logged but edit proceeds
- ✅ File modified

---

## Test 8: Artifact Truncation Toggle

### Disable truncation

```bash
cat > ~/.config/opencode/oh-my-opencode.json <<'EOF'
{
  "governance": {
    "artifact_truncation": {
      "enabled": false
    }
  }
}
EOF
```

**Prompt**:
```
Use implementation-specialist to analyze a complex file
```

**Expected**:
- ✅ Full response returned (no truncation)
- ✅ No artifact envelope format

---

## Debugging

### Check if hook is loaded

```bash
# Look for log entries
# (OpenCode logs to console by default)
```

Look for:
```
[oh-my-opencode] Governance docs delegation hook initialized { mode: 'block' }
```

### Verify config is read

```bash
cat ~/.config/opencode/oh-my-opencode.json
```

### Check agent registry

Verify document-writer agent is registered:
```bash
# In OpenCode session
@document-writer
```

Should show agent is available.

---

## Pass/Fail Criteria

| Test | Pass Criteria | Status |
|------|---------------|--------|
| Test 1 | README edit blocked or delegated | ⏳ |
| Test 2 | docs/ edit blocked or delegated | ⏳ |
| Test 3 | Spec folder allowed | ⏳ |
| Test 4 | Response ≤800 chars summary | ⏳ |
| Test 5 | Mixed task splits correctly | ⏳ |
| Test 6 | document-writer bypasses block | ⏳ |
| Test 7 | Config toggles work | ⏳ |
| Test 8 | Truncation toggle works | ⏳ |

---

## Reporting Issues

If tests fail, capture:
1. OpenCode version: `opencode --version`
2. Config: `cat ~/.config/opencode/oh-my-opencode.json`
3. Exact prompt used
4. Actual behavior vs expected
5. Error messages (full text)
6. Console logs

Report to: LIF-69 Linear issue comments
