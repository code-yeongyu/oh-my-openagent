---
name: lcx-contribute-bug-fix
description: "Contribute a verified bug fix for LazyCodex, lazycodex-ai, omo-codex, bundled Codex skills, or upstream Codex CLI bugs. LazyCodex-owned defects get a fork PR against code-yeongyu/oh-my-openagent (base dev, source-tree paths under packages/omo-codex/plugin, with the changelog fragment); upstream Codex bugs get a fork PR against openai/codex. code-yeongyu/lazycodex is a generated distribution mirror and never gets a PR. Use when the user asks to fix a bug, contribute a bug fix, contribute to fix bug, open a PR for a bug, or debug and PR a LazyCodex/Codex defect."
metadata:
  short-description: Contribute verified LazyCodex or Codex bug fixes
---

# lcx-contribute-bug-fix

Use this skill to debug a concrete LazyCodex or Codex defect, implement the smallest correct fix in a fresh temporary workspace, and deliver it. Work in English, keep the body short, and support every claim with runtime or source evidence.

Route ownership the same way as `$lcx-report-bug`, but the deliverable differs by target:

- `code-yeongyu/oh-my-openagent` (base branch `dev`) for LazyCodex, lazycodex-ai, omo-codex, bundled skills, hooks, MCP wiring, installer behavior, marketplace sync, docs, or packaging. Deliverable: a PR from a fork that edits the source-tree paths under `packages/omo-codex/plugin/` and carries the changelog fragment that repo requires. `code-yeongyu/lazycodex` is a distribution mirror generated from it (its `plugins/omo/` tree is synced from `packages/omo-codex/plugin/`), and the maintainer lands LazyCodex fixes from PRs against oh-my-openagent. NEVER open a PR or push a branch against `code-yeongyu/lazycodex`: its contents are regenerated on every release, so a PR there cannot be merged and will be closed. At most file a short issue there (symptom plus failing input) that links the oh-my-openagent PR; never embed a patch.
- `openai/codex` for upstream Codex CLI bugs that reproduce without LazyCodex or come from Codex core behavior. Deliverable: a PR from a fork.

## Required Outcome

For `code-yeongyu/oh-my-openagent` and `openai/codex`, create a fork PR that includes:

- a focused branch from a fresh `${TMPDIR:-/tmp}` clone/worktree
- reproduction logs from before the fix
- the smallest implementation that fixes the defect
- verification logs from after the fix
- apply `lazycodex-generated` when label management is available
- the required LazyCodex footer tag `Tag: lazycodex-generated`
- for `code-yeongyu/oh-my-openagent`: base `dev`, edits at `packages/omo-codex/plugin/...` (never the mirror's `plugins/omo/...` paths), and the changelog fragment `changes/unreleased/<pr-number>.md` that the repo's AGENTS.md describes
- cleanup of temporary worktrees and clones

For `code-yeongyu/lazycodex`, deliver no PR and no patch. When a pointer is useful there, file a short issue (symptom plus failing input, the `lazycodex-generated` label and the footer tag `Tag: lazycodex-generated`) that links the oh-my-openagent PR.

## Required Workflow

1. Read the user's bug report and identify the affected surface. Before commands, apply the bundled ultrawork directive’s Task resources and todo rules; read those sections if absent from context.
2. Invoke `$omo:debugging` for the investigation. If only unqualified skill names are exposed, invoke `$debugging` and state that it is the OMO debugging skill.
3. Search for an existing lead PR before anything is filed. Search your own open PRs across all repos by the symptom or the changed symbol, then the target repo's open PRs, so a fix that already exists is found first and gets new evidence instead of a duplicate:

```bash
gh search prs --author @me --state open "<symbol or error text>"
gh search prs --repo code-yeongyu/oh-my-openagent --state open "<symbol or error text>"
```

If a matching open PR exists, add evidence to it or report it instead of opening a second one.
4. Materialize the latest sources under `LAZYCODEX_SOURCE_ROOT="${LAZYCODEX_SOURCE_ROOT:-${TMPDIR:-/tmp}/lazycodex-sources}"`, then decide the target repository. Sync the checkouts on every run and compare them before choosing. Validate cached checkouts before reuse so an incomplete `.git` directory cannot route the fix to the wrong repo:

```bash
# The default checkout cache is per-task under TMPDIR=$RUN_TMP.
LAZYCODEX_SOURCE_ROOT="${LAZYCODEX_SOURCE_ROOT:-${TMPDIR:-/tmp}/lazycodex-sources}"
mkdir -p "$LAZYCODEX_SOURCE_ROOT"

valid_source_checkout() {
  DEST="$1"
  git -C "$DEST" rev-parse --is-inside-work-tree >/dev/null 2>&1 &&
    git -C "$DEST" config --get remote.origin.url >/dev/null 2>&1
}

recover_corrupt_source_checkout() {
  DEST="$1"
  if [ -e "$DEST" ] && ! valid_source_checkout "$DEST"; then
    QUARANTINED="$DEST.corrupt.$(date +%Y%m%d%H%M%S)"
    mv "$DEST" "$QUARANTINED"
    echo "Moved corrupt source cache $DEST to $QUARANTINED" >&2
  fi
}

sync_latest_source() {
  REPO="$1"; DEST="$2"
  recover_corrupt_source_checkout "$DEST"
  if [ ! -d "$DEST" ]; then
    gh repo clone "$REPO" "$DEST" -- --depth=1 \
      || git clone --depth=1 "https://github.com/$REPO" "$DEST"
  fi
  if ! valid_source_checkout "$DEST"; then
    echo "Source cache $DEST is not a usable git checkout after clone" >&2
    return 1
  fi
  git -C "$DEST" remote set-url origin "https://github.com/$REPO.git" >/dev/null 2>&1 || true
  DEFAULT_BRANCH="$(git -C "$DEST" remote show origin | sed -n '/HEAD branch/s/.*: //p')"
  if [ -z "$DEFAULT_BRANCH" ]; then
    DEFAULT_BRANCH="$(git -C "$DEST" symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##')"
  fi
  if [ -z "$DEFAULT_BRANCH" ]; then
    echo "Could not determine default branch for $REPO in $DEST" >&2
    return 1
  fi
  git -C "$DEST" fetch --depth=1 origin "$DEFAULT_BRANCH"
  git -C "$DEST" checkout -B "$DEFAULT_BRANCH" FETCH_HEAD
}
sync_latest_source code-yeongyu/lazycodex "$LAZYCODEX_SOURCE_ROOT/lazycodex-source"
sync_latest_source code-yeongyu/oh-my-openagent "$LAZYCODEX_SOURCE_ROOT/oh-my-openagent-source"
sync_latest_source openai/codex "$LAZYCODEX_SOURCE_ROOT/chatgpt-subscription-source"
```
5. Create a fresh temporary clone and branch under `${TMPDIR:-/tmp}`. Do not modify the user's current repository for the target fix unless the current repository is itself the requested target and the user explicitly asked for local edits. Apply those resource rules at clone/worktree creation.

```bash
TARGET_REPO="code-yeongyu/oh-my-openagent" # or openai/codex
WORK_ROOT="${RUN_TMP:?apply ultrawork Task resources first}"
gh repo clone "$TARGET_REPO" "$WORK_ROOT/repo" -- --depth=1
cd "$WORK_ROOT/repo"
BASE_BRANCH="$(git remote show origin | sed -n '/HEAD branch/s/.*: //p')"
git fetch origin "$BASE_BRANCH" --depth=1
BRANCH_NAME="lazycodex/bug-fix-<short-slug>"
git worktree add "$WORK_ROOT/worktree" -b "$BRANCH_NAME" "origin/$BASE_BRANCH"
cd "$WORK_ROOT/worktree"
```

If `gh` cannot clone, use `git clone --depth=1 "https://github.com/$TARGET_REPO" "$WORK_ROOT/repo"` and continue with the same worktree flow.

6. Reproduce the bug in the worktree through the real surface. Save exact command output to `${TMPDIR:-/tmp}/lazycodex-fix-<short-slug>-repro.log`.
7. Write or update a failing regression test before production changes. Confirm it fails for the bug, not for a missing fixture or typo.
8. Implement the smallest correct fix. Avoid refactors unless the fix cannot be made safely without one.
9. Run the regression test, adjacent tests, and the smallest real-surface QA command that proves the user-visible behavior changed.
10. Commit the verified fix in the worktree. Inspect the status first so the delivered diff cannot be empty or stale:

```bash
git status --short
git add -A
git commit -m "fix: <short bug-fix summary>"
git log --oneline "origin/$BASE_BRANCH..HEAD"
```

11. Build the delivery body for the target:
   - `code-yeongyu/oh-my-openagent` and `openai/codex`: generate the PR body with `scripts/create-pr-body.mjs` (set `targetRepository` to the repo you are filing against).
   - `code-yeongyu/oh-my-openagent` only: add the changelog fragment `changes/unreleased/<pr-number>.md` once the PR number exists, in the format `docs/reference/changelog-fragments.md` of that repo defines, and commit it to the same branch.

12. Ensure the generated label exists when the target repo allows label management. Keep the footer tag even when label creation is unavailable:

```bash
LABEL_ARGS=()
if gh label create lazycodex-generated --repo "$TARGET_REPO" --color "7C3AED" --description "Created by LazyCodex" --force; then
  LABEL_ARGS=(--label lazycodex-generated)
else
  echo "Label management unavailable for $TARGET_REPO; keeping the footer tag only."
fi
```

13. Deliver the fix.
   - `code-yeongyu/oh-my-openagent`: fork, push the branch to the fork, and create the PR against base `dev`. Never push a branch to or run `gh pr create` against `code-yeongyu/lazycodex`:

```bash
gh repo fork code-yeongyu/oh-my-openagent --remote --remote-name fork
GH_USER="$(gh api user --jq .login)"
git push -u fork "$BRANCH_NAME"
gh pr create --repo code-yeongyu/oh-my-openagent --base dev --head "$GH_USER:$BRANCH_NAME" --title "<short fix title>" "${LABEL_ARGS[@]}" --body-file "$PR_BODY"
```

   - `code-yeongyu/lazycodex` (optional pointer): a short issue with the symptom, the failing input and a link to the oh-my-openagent PR, never a diff:

```bash
ISSUE_BODY="${TMPDIR:-/tmp}/lazycodex-fix-<short-slug>-issue.md"
gh issue create --repo code-yeongyu/lazycodex --title "<short fix title>" "${LABEL_ARGS[@]}" --body-file "$ISSUE_BODY"
```

   - `openai/codex`: fork, push the branch to the fork, and create the PR:

```bash
gh repo fork openai/codex --remote --remote-name fork
GH_USER="$(gh api user --jq .login)"
git push -u fork "$BRANCH_NAME"
gh pr create --repo openai/codex --base "$BASE_BRANCH" --head "$GH_USER:$BRANCH_NAME" --title "<short fix title>" "${LABEL_ARGS[@]}" --body-file "$PR_BODY"
```

14. Finish cleanup per Task resources. Run this only when that rule permits removing the worktree and run root; otherwise retain them and report the outstanding cleanup todo:

```bash
cd /
git -C "$WORK_ROOT/repo" worktree remove "$WORK_ROOT/worktree"
unset TMPDIR NODE_COMPILE_CACHE BUN_RUNTIME_TRANSPILER_CACHE_PATH
find "$WORK_ROOT" -mindepth 1 -maxdepth 1 -exec rm -r -- {} +
rmdir "$WORK_ROOT"
test ! -e "$WORK_ROOT" && printf 'cleanup: worktree and caches REMOVED\n'
```

Return the PR or issue URL, the reproduction command, the verification command, and the cleanup receipt.

## Pointer Issue Template (code-yeongyu/lazycodex, optional)

Write the issue body in English. It names the symptom and the failing input and links the oh-my-openagent PR; the fix itself lives in that PR:

````markdown
## Symptom
[What failed for the user.]

## Failing Input
[Exact failing command and the shortest log excerpt.]

## Fix
[Link to the code-yeongyu/oh-my-openagent PR.]

---
This issue was generated by LazyCodex.
Tag: lazycodex-generated
````

## PR Body Generator (openai/codex)

Use the bundled script to generate the PR body. Create a JSON file with this shape:

```json
{
  "title": "Fix short user-visible failure",
  "targetRepository": "openai/codex",
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
PR_INPUT="${TMPDIR:-/tmp}/lazycodex-fix-<short-slug>-pr.json"
PR_BODY="${TMPDIR:-/tmp}/lazycodex-fix-<short-slug>-pr.md"
node "<skill-root>/scripts/create-pr-body.mjs" "$PR_INPUT" "$PR_BODY"
```

## PR Body Template (openai/codex)

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
- authentication is missing for creating the issue or pushing and creating the PR
- the fix requires a product decision rather than a technical correction

Do not open:

- a PR or pushed branch targeting `code-yeongyu/lazycodex` — send the fix as a PR against `code-yeongyu/oh-my-openagent` instead, always
- a PR for a defect that already has an open lead PR found by the search in step 3
- a PR without a failing-before and passing-after test
- a PR without a real-surface QA command
- a PR or issue without the `Tag: lazycodex-generated` footer
- an issue on `code-yeongyu/lazycodex` that embeds a patch
- a vague fix that does not identify the root cause
- a broad refactor disguised as a bug fix
