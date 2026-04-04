---
name: work-with-pr
description: "Full PR lifecycle: git worktree → implement → atomic commits → PR creation → verification loop (CI + review-work + Cubic approval) → merge. Keeps iterating until ALL gates pass and PR is merged. Worktree auto-cleanup after merge. Use whenever implementation work needs to land as a PR. Triggers: 'create a PR', 'implement and PR', 'work on this and make a PR', 'implement issue', 'land this as a PR', 'work-with-pr', 'PR workflow', 'implement end to end', even when user just says 'implement X' if the context implies PR delivery."
---

# Work With PR — Full PR Lifecycle

You are executing a complete PR lifecycle: from isolated worktree setup through implementation, PR creation, and an unbounded verification loop until the PR is merged. The loop has three gates — CI, review-work, and Cubic — and you keep fixing and pushing until all three pass simultaneously.

<architecture>

```
Phase 0: Setup         → Branch + worktree in sibling directory
Phase 1: Implement     → Do the work, atomic commits
Phase 2: PR Creation   → Push, create PR targeting dev
Phase 3: Verify Loop   → Unbounded iteration until ALL gates pass:
  ├─ Gate A: CI         → gh pr checks (bun test, typecheck, build)
  ├─ Gate B: review-work → 5-agent parallel review
  └─ Gate C: Cubic      → cubic-dev-ai[bot] "No issues found"
Phase 4: Merge         → Squash merge, worktree cleanup
```

</architecture>

---

## Phase 0: Setup

Create an isolated worktree so the user's main working directory stays clean. This matters because the user may have uncommitted work, and checking out a branch would destroy it.

<setup>

### 1. Resolve repository context

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPO_NAME=$(basename "$PWD")
BASE_BRANCH="dev"  # CI blocks PRs to master
```

### 2. Create branch

If user provides a branch name, use it. Otherwise, derive from the task:

```bash
# Auto-generate: feature/short-description or fix/short-description
BRANCH_NAME="feature/$(echo "$TASK_SUMMARY" | tr '[:upper:] ' '[:lower:]-' | head -c 50)"
git fetch origin "$BASE_BRANCH"
git branch "$BRANCH_NAME" "origin/$BASE_BRANCH"
```

### 3. Create worktree

Place worktrees as siblings to the repo — not inside it. This avoids git nested repo issues and keeps the working tree clean.

```bash
WORKTREE_PATH="../${REPO_NAME}-wt/${BRANCH_NAME}"
mkdir -p "$(dirname "$WORKTREE_PATH")"
git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
```

### 4. Set working context

All subsequent work happens inside the worktree. Install dependencies if needed:

```bash
cd "$WORKTREE_PATH"
# If bun project:
[ -f "bun.lock" ] && bun install
```

</setup>

---

## Phase 1: Implement

Do the actual implementation work inside the worktree. The agent using this skill does the work directly — no subagent delegation for the implementation itself.

**Scope discipline**: For bug fixes, stay minimal. Fix the bug, add a test for it, done. Do not refactor surrounding code, add config options, or "improve" things that aren't broken. The verification loop will catch regressions — trust the process.

<implementation>

### Commit strategy

Use the git-master skill's atomic commit principles. The reason for atomic commits: if CI fails on one change, you can isolate and fix it without unwinding everything.

```
3+ files changed  → 2+ commits minimum
5+ files changed  → 3+ commits minimum
10+ files changed → 5+ commits minimum
```

Each commit should pair implementation with its tests. Load `git-master` skill when committing:

```
task(category="quick", load_skills=["git-master"], prompt="Commit the changes atomically following git-master conventions. Repository is at {WORKTREE_PATH}.")
```

### Pre-push local validation

Before pushing, run the same checks CI will run. Catching failures locally saves a full CI round-trip (~3-5 min):

```bash
bun run typecheck
bun test
bun run build
```

Fix any failures before pushing. Each fix-commit cycle should be atomic.

</implementation>

---

## Phase 2: PR Creation

<pr_creation>

### Push and create PR

```bash
git push -u origin "$BRANCH_NAME"
```

Create the PR using the project's template structure:

```bash
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$(cat <<'EOF'
## Summary
[1-3 sentences describing what this PR does and why]

## Changes
[Bullet list of key changes]

## Testing
- `bun run typecheck` ✅
- `bun test` ✅
- `bun run build` ✅

## Related Issues
[Link to issue if applicable]
EOF
)"
```

Capture the PR number:

```bash
PR_NUMBER=$(gh pr view --json number -q .number)
```

</pr_creation>

---

## Phase 3: Verification Loop

This is the core of the skill. Three gates must ALL pass for the PR to be ready. The loop has no iteration cap — keep going until done. Gate ordering is intentional: CI is cheapest/fastest, review-work is most thorough, Cubic is external and asynchronous.

<verify_loop>

```
while true:
  1. Wait for CI          → Gate A
  2. If CI fails          → read logs, fix, commit, push, continue
  3. Run review-work      → Gate B
  4. If review fails      → fix blocking issues, commit, push, continue
  5. Check Cubic          → Gate C
  6. If Cubic has issues   → fix issues, commit, push, continue
  7. All three pass       → break
```

### Gate A: CI Checks

CI is the fastest feedback loop. Wait for it to complete, then parse results.

```bash
# Wait for checks to start (GitHub needs a moment after push)
# Then watch for completion
gh pr checks "$PR_NUMBER" --watch --fail-fast
```

**On failure**: Get the failed run logs to understand what broke:

```bash
# Find the failed run
RUN_ID=$(gh run list --branch "$BRANCH_NAME" --status failure --json databaseId --jq '.[0].databaseId')

# Get failed job logs
gh run view "$RUN_ID" --log-failed
```

Read the logs, fix the issue, commit atomically, push, and re-enter the loop.

### Gate B: review-work

The review-work skill launches 5 parallel sub-agents (goal verification, QA, code quality, security, context mining). All 5 must pass.

Invoke review-work after CI passes — there's no point reviewing code that doesn't build:

```
task(
  category="unspecified-high",
  load_skills=["review-work"],
  run_in_background=false,
  description="Post-implementation review of PR changes",
  prompt="Review the implementation work on branch {BRANCH_NAME}. The worktree is at {WORKTREE_PATH}. Goal: {ORIGINAL_GOAL}. Constraints: {CONSTRAINTS}. Run command: bun run dev (or as appropriate)."
)
```

**On failure**: review-work reports blocking issues with specific files and line numbers. Fix each blocking issue, commit, push, and re-enter the loop from Gate A (since code changed, CI must re-run).

### Gate C: Cubic Approval

Cubic (`cubic-dev-ai[bot]`) is an automated review bot that comments on PRs. It does NOT use GitHub's APPROVED review state — instead it posts comments with issue counts and confidence scores.

**Approval signal**: The latest Cubic comment contains `**No issues found**` and confidence `**5/5**`.

**Issue signal**: The comment lists issues with file-level detail.

```bash
# Get the latest Cubic review
CUBIC_REVIEW=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
  --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .body')

# Check if approved
if echo "$CUBIC_REVIEW" | grep -q "No issues found"; then
  echo "Cubic: APPROVED"
else
  echo "Cubic: ISSUES FOUND"
  echo "$CUBIC_REVIEW"
fi
```

**On issues**: Cubic's review body contains structured issue descriptions. Parse them, determine which are valid (some may be false positives), fix the valid ones, commit, push, re-enter from Gate A.

Cubic reviews are triggered automatically on PR updates. After pushing a fix, wait for the new review to appear before checking again. Use `gh api` polling with a conditional loop:

```bash
# Wait for new Cubic review after push
PUSH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
while true; do
  LATEST_REVIEW_TIME=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
    --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .submitted_at')
  if [[ "$LATEST_REVIEW_TIME" > "$PUSH_TIME" ]]; then
    break
  fi
  # Use gh api call itself as the delay mechanism — each call takes ~1-2s
  # For longer waits, use: timeout 30 gh pr checks "$PR_NUMBER" --watch 2>/dev/null || true
done
```

### Iteration discipline

Each iteration through the loop:
1. Fix ONLY the issues identified by the failing gate
2. Commit atomically (one logical fix per commit)
3. Push
4. Re-enter from Gate A (code changed → full re-verification)

Avoid the temptation to "improve" unrelated code during fix iterations. Scope creep in the fix loop makes debugging harder and can introduce new failures.

</verify_loop>

---

## Phase 4: Merge & Cleanup

Once all three gates pass:

<merge_cleanup>

### Merge the PR

```bash
# Squash merge to keep history clean
gh pr merge "$PR_NUMBER" --squash --delete-branch
```

### Sync .sisyphus state back to main repo

Before removing the worktree, copy `.sisyphus/` state back. When `.sisyphus/` is gitignored, files written there during worktree execution are not committed or merged — they would be lost on worktree removal.

```bash
# Sync .sisyphus state from worktree to main repo (preserves task state, plans, notepads)
if [ -d "$WORKTREE_PATH/.sisyphus" ]; then
  mkdir -p "$ORIGINAL_DIR/.sisyphus"
  cp -r "$WORKTREE_PATH/.sisyphus/"* "$ORIGINAL_DIR/.sisyphus/" 2>/dev/null || true
fi
```

### Clean up the worktree

The worktree served its purpose — remove it to avoid disk bloat:

```bash
cd "$ORIGINAL_DIR"  # Return to original working directory
git worktree remove "$WORKTREE_PATH"
# Prune any stale worktree references
git worktree prune
```

### Report completion

Summarize what happened:

```
## PR Merged ✅

- **PR**: #{PR_NUMBER} — {PR_TITLE}
- **Branch**: {BRANCH_NAME} → {BASE_BRANCH}
- **Iterations**: {N} verification loops
- **Gates passed**: CI ✅ | review-work ✅ | Cubic ✅
- **Worktree**: cleaned up
```

</merge_cleanup>

---

## Failure Recovery

<failure_recovery>

If you hit an unrecoverable error (e.g., merge conflict with base branch, infrastructure failure):

1. **Do NOT delete the worktree** — the user may want to inspect or continue manually
2. Report what happened, what was attempted, and where things stand
3. Include the worktree path so the user can resume

For merge conflicts:

```bash
cd "$WORKTREE_PATH"
git fetch origin "$BASE_BRANCH"
git rebase "origin/$BASE_BRANCH"
# Resolve conflicts, then continue the loop
```

</failure_recovery>

---

## Anti-Patterns

| Violation | Why it fails | Severity |
|-----------|-------------|----------|
| Working in main worktree instead of isolated worktree | Pollutes user's working directory, may destroy uncommitted work | CRITICAL |
| Pushing directly to dev/master | Bypasses review entirely | CRITICAL |
| Skipping CI gate after code changes | review-work and Cubic may pass on stale code | CRITICAL |
| Fixing unrelated code during verification loop | Scope creep causes new failures | HIGH |
| Deleting worktree on failure | User loses ability to inspect/resume | HIGH |
| Ignoring Cubic false positives without justification | Cubic issues should be evaluated, not blindly dismissed | MEDIUM |
| Giant single commits | Harder to isolate failures, violates git-master principles | MEDIUM |
| Not running local checks before push | Wastes CI time on obvious failures | MEDIUM |
