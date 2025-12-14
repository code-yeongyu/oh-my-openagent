---
description: Compare HEAD with the latest published npm version and list all unpublished changes
model: anthropic/claude-haiku-4-5
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
| X | 실제 변경 내용 설명 |

### fix
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### refactor
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### docs
| Scope | What Changed |
|-------|--------------|
| X | 실제 변경 내용 설명 |

### Breaking Changes
None 또는 목록

### Files Changed
{diff-stat}

### Suggested Version Bump
- **Recommendation**: patch|minor|major
- **Reason**: 이유
</output-format>
