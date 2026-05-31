---
name: get-unpublished-changes
description: "Compare HEAD with the latest published npm version and list all unpublished changes. Triggers: unpublished changes, changelog, what changed, whats new."
---

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
