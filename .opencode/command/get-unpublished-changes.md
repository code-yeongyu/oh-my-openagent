---
description: Compare HEAD with the latest published npm version and list all unpublished changes
model: anthropic/claude-haiku-4-5
---

<command-instruction>
Analyze the unpublished changes since the last npm release and provide a structured summary.

Your task:
1. Review the context below (auto-injected via shell)
2. Summarize changes grouped by type (feat, fix, refactor, docs, chore)
3. Highlight breaking changes if any
4. Suggest next version bump (major/minor/patch) based on conventional commits
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

### Commits ({count})
| Type | Scope | Description |
|------|-------|-------------|
| ... | ... | ... |

### Files Changed
{diff-stat summary}

### Suggested Version Bump
- **Recommendation**: {patch|minor|major}
- **Reason**: {brief explanation}
</output-format>
