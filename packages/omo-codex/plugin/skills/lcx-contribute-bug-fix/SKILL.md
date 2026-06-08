---
name: lcx-contribute-bug-fix
description: "Contribute a verified bug-fix PR for LazyCodex, lazycodex-ai, omo-codex, bundled Codex skills, or upstream Codex CLI bugs. Use when the user asks to fix a bug, contribute a bug fix, contribute to fix bug, open a PR for a bug, or debug and PR a LazyCodex/Codex defect."
metadata:
  short-description: Contribute verified LazyCodex or Codex bug-fix PRs
---

# lcx-contribute-bug-fix

Use this skill to debug a concrete LazyCodex or Codex defect, implement the smallest correct fix in a fresh temporary workspace, and open a GitHub PR. Work in English, keep the PR body short, and support every claim with runtime or source evidence.

Route ownership the same way as `$lcx-report-bug`:

- `code-yeongyu/lazycodex` for LazyCodex, lazycodex-ai, omo-codex, bundled skills, hooks, MCP wiring, installer behavior, marketplace sync, docs, or packaging.
- `openai/codex` for upstream Codex CLI bugs that reproduce without LazyCodex or come from Codex core behavior.

## Required Outcome

Create a PR that includes:

- a focused branch from a fresh `/tmp` clone/worktree
- reproduction logs from before the fix
- the smallest implementation that fixes the defect
- verification logs from after the fix
- apply `lazycodex-generated` when label management is available
- the required LazyCodex footer tag `Tag: lazycodex-generated`
- cleanup of temporary worktrees and clones

## Required Workflow

1. Read the user's bug report and identify the affected surface.
2. Invoke `$omo:debugging` for the investigation. If only unqualified skill names are exposed, invoke `$debugging` and state that it is the OMO debugging skill.
3. Decide the target repository. If ownership is close, compare against upstream Codex source under `/tmp/openai-codex-source` before choosing.
4. Create a fresh temporary clone and branch. Do not modify the user's current repository for the target fix unless the current repository is itself the requested target and the user explicitly asked for local edits.

```bash
TARGET_REPO="code-yeongyu/lazycodex" # or openai/codex
WORK_ROOT="$(mktemp -d /tmp/lazycodex-fix-XXXXXX)"
gh repo clone "$TARGET_REPO" "$WORK_ROOT/repo" -- --depth=1
cd "$WORK_ROOT/repo"
BASE_BRANCH="$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')"
git fetch origin "$BASE_BRANCH" --depth=1
BRANCH_NAME="lazycodex/bug-fix-<short-slug>"
git worktree add "$WORK_ROOT/worktree" -b "$BRANCH_NAME" "origin/$BASE_BRANCH"
cd "$WORK_ROOT/worktree"
```

If `gh` cannot clone, use `git clone --depth=1 "https://github.com/$TARGET_REPO" "$WORK_ROOT/repo"` and continue with the same worktree flow.

5. Reproduce the bug in the worktree through the real surface. Save exact command output to `/tmp/lazycodex-fix-<short-slug>-repro.log`.
6. Write or update a failing regression test before production changes. Confirm it fails for the bug, not for a missing fixture or typo.
7. Implement the smallest correct fix. Avoid refactors unless the fix cannot be made safely without one.
8. Run the regression test, adjacent tests, and the smallest real-surface QA command that proves the user-visible behavior changed.
9. Commit the verified fix before pushing. Inspect the status first so the PR cannot be empty or stale:

```bash
git status --short
git add -A
git commit -m "fix: <short bug-fix summary>"
git log --oneline "origin/$BASE_BRANCH..HEAD"
```

10. Generate the PR body with `scripts/create-pr-body.mjs`.
11. Ensure the generated label exists when the target repo allows label management. Keep the footer tag even when label creation is unavailable:

```bash
LABEL_ARGS=()
if gh label create lazycodex-generated --repo "$TARGET_REPO" --color "7C3AED" --description "Created by LazyCodex" --force; then
  LABEL_ARGS=(--label lazycodex-generated)
else
  echo "Label management unavailable for $TARGET_REPO; keeping the footer tag only."
fi
```

12. Push to a writable remote, then create the PR. For upstream `openai/codex`, fork first and use the fork as the head repository:

```bash
PUSH_REMOTE="origin"
PR_HEAD="$BRANCH_NAME"
if [ "$TARGET_REPO" = "openai/codex" ]; then
  gh repo fork "$TARGET_REPO" --remote --remote-name fork
  PUSH_REMOTE="fork"
  GH_USER="$(gh api user --jq .login)"
  PR_HEAD="$GH_USER:$BRANCH_NAME"
fi

git push -u "$PUSH_REMOTE" "$BRANCH_NAME"
gh pr create --repo "$TARGET_REPO" --base "$BASE_BRANCH" --head "$PR_HEAD" --title "<short fix title>" "${LABEL_ARGS[@]}" --body-file "$PR_BODY"
```

13. Clean up:

```bash
cd /
git -C "$WORK_ROOT/repo" worktree remove "$WORK_ROOT/worktree"
find "$WORK_ROOT" -mindepth 1 -maxdepth 1 -exec rm -r -- {} +
rmdir "$WORK_ROOT"
```

Return the PR URL, the reproduction command, the verification command, and the cleanup receipt.

## PR Body Generator

Use the bundled script to generate the PR body. Create a JSON file with this shape:

```json
{
  "title": "Fix short user-visible failure",
  "targetRepository": "code-yeongyu/lazycodex",
  "problem": "What is broken for the user.",
  "reproductionLogs": "Exact failing command, log excerpt, or trace.",
  "approach": "What changed and why this is the smallest correct fix.",
  "confidence": "Why the diagnosis and fix are strongly supported.",
  "risks": "Risk level and what could regress.",
  "userVisibleBehaviorChanges": "What changes for the user after the PR.",
  "verification": ["failing test before fix", "passing test after fix", "manual QA command"]
}
```

Run:

```bash
PR_INPUT="/tmp/lazycodex-fix-<short-slug>-pr.json"
PR_BODY="/tmp/lazycodex-fix-<short-slug>-pr.md"
node "<skill-root>/scripts/create-pr-body.mjs" "$PR_INPUT" "$PR_BODY"
```

## PR Body Template

The generated body must follow this structure:

```markdown
## Problem Situation
[What failed for the user.]

## Reproduction Logs
[Exact failing command and relevant log excerpt.]

## Approach
[What changed and why.]

## Why I Am Confident
[Evidence that proves the root cause and fix.]

## Risks
[Risk level and possible regressions.]

## User-Visible Behavior Changes
[What users experience after this PR.]

## Verification
- [RED test output or repro before the fix]
- [GREEN test output after the fix]
- [Manual QA command and result]

---
This PR was debugged, implemented, and created with [LazyCodex](https://github.com/code-yeongyu/lazycodex).
Tag: lazycodex-generated
```

## Stop Conditions

Stop and ask one narrow question only when:

- the bug cannot be reproduced from available information
- target repository ownership remains ambiguous after comparing LazyCodex and upstream Codex evidence
- authentication is missing for pushing or creating the PR
- the fix requires a product decision rather than a technical correction

Do not open:

- a PR without a failing-before and passing-after test
- a PR without a real-surface QA command
- a PR without the `Tag: lazycodex-generated` footer
- a vague fix that does not identify the root cause
- a broad refactor disguised as a bug fix
