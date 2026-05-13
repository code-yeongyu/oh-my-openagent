---
description: Compare HEAD with the latest published npm version and list all unpublished changes
---

<command-instruction>
IMMEDIATELY output the analysis. NO questions. NO preamble.

## CRITICAL: DO NOT just copy commit messages!

For each commit, you MUST:
1. Read the actual diff to understand WHAT CHANGED
2. Describe the REAL change in plain language
3. Explain WHY it matters (if not obvious)

## Steps:
1. Run `git diff v{published-version}..HEAD` to see actual changes
2. Group by type (feat/fix/refactor/docs) with REAL descriptions
3. Note breaking changes if any
4. Recommend version bump (major/minor/patch)

## Output Format:
- feat: "Added X that does Y" (not just "add X feature")
- fix: "Fixed bug where X happened, now Y" (not just "fix X bug")
- refactor: "Changed X from A to B, now supports C" (not just "rename X")
</command-instruction>

<version-context>
<published-version>
!`npm view oh-my-opencode version 2>/dev/null || echo "not published"`
</published-version>
<local-version>
!`node -p "require('./package.json').version" 2>/dev/null || echo "unknown"`
</local-version>
<latest-tag>
!`git tag --sort=-v:refname | head -1 2>/dev/null || echo "no tags"`
</latest-tag>
</version-context>

<git-context>
<commits-since-release>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git log "v{}"..HEAD --oneline 2>/dev/null || echo "no commits since release"`
</commits-since-release>
<diff-stat>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null || echo "no diff available"`
</diff-stat>
<files-changed-summary>
!`npm view oh-my-opencode version 2>/dev/null | xargs -I{} git diff "v{}"..HEAD --stat 2>/dev/null | tail -1 || echo ""`
</files-changed-summary>
</git-context>

<output-format>
## Unpublished Changes (v{published} → HEAD)

### feat
| Scope | What Changed |
|-------|--------------|
| X | Description of actual changes |

### fix
| Scope | What Changed |
|-------|--------------|
| X | Description of actual changes |

### refactor
| Scope | What Changed |
|-------|--------------|
| X | Description of actual changes |

### docs
| Scope | What Changed |
|-------|--------------|
| X | Description of actual changes |

### Breaking Changes
None or list

### Files Changed
{diff-stat}

### Suggested Version Bump
- **Recommendation**: patch|minor|major
- **Reason**: Reason for recommendation
</output-format>

<oracle-safety-review>
## Oracle Deployment Safety Review (Only when user explicitly requests)

**Trigger keywords**: "safe to deploy", "can I deploy", "is it safe", "review", "check", "oracle"

When user includes any of the above keywords in their request:

### 1. Pre-validation
```bash
bun run typecheck
bun test
```
- On failure → Report "❌ Cannot deploy" immediately without invoking Oracle

### 2. Oracle Invocation Prompt

Collect the following information and pass to Oracle:

```
## Deployment Safety Review Request

### Changes Summary
{Changes table analyzed above}

### Key diffs (organized by feature)
{Core code changes for each feat/fix/refactor - only key parts, not full diff}

### Validation Results
- Typecheck: ✅/❌
- Tests: {pass}/{total} (✅/❌)

### Review Items
1. **Regression Risk**: Are there changes that could affect existing functionality?
2. **Side Effects**: Are there areas where unexpected side effects could occur?
3. **Breaking Changes**: Are there changes that affect external users?
4. **Edge Cases**: Are there missed edge cases?
5. **Deployment Recommendation**: SAFE / CAUTION / UNSAFE

### Request
Please analyze the above changes deeply and provide your judgment on deployment safety.
If there are risks, explain with specific scenarios.
Suggest keywords to monitor after deployment if any.
```

### 3. Output Format After Oracle Response

## 🔍 Oracle Deployment Safety Review Result

### Verdict: ✅ SAFE / ⚠️ CAUTION / ❌ UNSAFE

### Risk Analysis
| Area | Risk Level | Description |
|------|------------|-------------|
| ... | 🟢/🟡/🔴 | ... |

### Recommendations
- ...

### Post-deployment Monitoring Keywords
- ...

### Conclusion
{Oracle's final judgment}
</oracle-safety-review>
