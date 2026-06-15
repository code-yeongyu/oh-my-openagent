---
name: work-with-pr
description: "Full PR lifecycle in an isolated git worktree: implement via the ulw-loop skill with mandatory evidence-bound manual QA → detailed English PR → verification loop (CI + review-work reviewers + Cubic, where Cubic is skipped only when its quota is exhausted) → merge by default → worktree cleanup. Unbounded loop: any failing gate sends you back to fix-and-re-QA inside the worktree. Use whenever implementation work needs to land as a PR. Triggers: 'create a PR', 'implement and PR', 'work on this and make a PR', 'implement issue', 'land this as a PR', 'work-with-pr', 'PR workflow', 'implement end to end', even when user just says 'implement X' if the context implies PR delivery."
---

# Work With PR — Full PR Lifecycle

You are executing a complete PR lifecycle: from isolated worktree setup, through `ulw-loop`-driven implementation with evidence-bound manual QA, PR creation, and an unbounded verification loop until the PR is merged. The loop has three gates — CI, review-work, and Cubic — and a failing gate sends you back into the worktree to fix and re-QA. You keep cycling until every active gate passes at once.

<architecture>

```
Phase 0: Setup         → Branch + worktree in sibling directory
Phase 1: Implement     → Drive the work through the ulw-loop skill:
                         evidence-bound manual QA per success criterion, atomic commits
Phase 2: PR Creation   → Push, create a detailed English PR targeting dev
Phase 3: Verify Loop   → Unbounded iteration; a failing gate routes back to Phase 1:
  ├─ Gate A: CI         → gh pr checks (bun test, typecheck, build)
  ├─ Gate B: review-work → 5-agent parallel review (the reviewer subagents)
  └─ Gate C: Cubic      → cubic-dev-ai[bot] "No issues found"
                         (SKIPPED, not failed, when Cubic's quota is exhausted)
Phase 4: Merge         → Merge by default, then worktree cleanup
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

Drive all implementation through the `ulw-loop` skill (your harness's native ultrawork loop) from inside the worktree. Do not free-hand the work: `ulw-loop` decomposes the brief into goals with binary success criteria, delegates code edits and QA to right-sized subagents, and — the reason it is mandatory here — forces every success criterion to be proven with evidence-bound **manual QA on a real surface**, not just a green test suite.

**Manual QA is the gate, not the tests.** This repo's rule is absolute: a change that reaches OpenCode or Codex is not done until you have driven the real harness (tmux / HTTP / browser / GUI — use the manual-QA channel table in the `ulw-loop` skill) AND written the evidence to disk. No evidence file means the QA did not happen, and you may NOT commit or push. "It typechecks" and "`bun test` is green" are NOT QA.

<implementation>

### Scope discipline

For bug fixes, stay minimal: fix the bug, add a test, prove it, stop. Do not refactor surrounding code, add config options, or "improve" things that aren't broken — the verification loop catches regressions, and scope creep makes failures harder to isolate.

### Commit strategy

`ulw-loop` commits through `git-master`. Keep commits atomic so that if CI fails on one change you can isolate and fix it without unwinding everything:

```
3+ files changed  → 2+ commits minimum
5+ files changed  → 3+ commits minimum
10+ files changed → 5+ commits minimum
```

Each commit pairs implementation with its tests, and you commit a criterion only after its QA evidence is on disk.

### Pre-push local validation

Before pushing, run the same checks CI will run — a cheap pre-filter that saves a ~3-5 min CI round-trip, NOT a substitute for the manual QA above:

```bash
bun run typecheck
bun test
bun run build
```

Fix any failure before pushing; each fix is its own atomic commit.

</implementation>

---

## Phase 2: PR Creation

<pr_creation>

### Push and create PR

```bash
git push -u origin "$BRANCH_NAME"
```

Write the PR body in English, detailed enough that a reviewer understands the change without reading the diff. The Verification section is where the manual-QA evidence from Phase 1 earns its place — cite what you actually drove and where the artifact lives, not just that tests passed.

```bash
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$(cat <<'EOF'
## Summary
[2-4 sentences: what this PR does, why it's needed, and the approach taken]

## Changes
[Bullet list of key changes, grouped by area; enough that a reviewer can map each bullet to the diff]

## Verification
**Automated:** `bun run typecheck` ✅ · `bun test` ✅ · `bun run build` ✅
**Manual QA:** [per success criterion — the channel driven (tmux/HTTP/browser/GUI), what you observed, and the evidence artifact path]

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

This is the core of the skill. Every active gate must pass for the PR to be ready. The loop has no iteration cap — keep going until done. Gate ordering is intentional: CI is cheapest/fastest, review-work is most thorough, Cubic is external and asynchronous. Gate C (Cubic) is the one gate that can be SKIPPED rather than satisfied — only when its quota is exhausted; it is never skipped just because it found issues. A failing gate is not a patch-and-push: route back to Phase 1, where fixes get the same scope discipline and, if behavior changed, fresh manual-QA evidence before you re-enter the loop.

<verify_loop>

```
while true:
  1. Wait for CI          → Gate A
  2. If CI fails          → back to Phase 1: read logs, fix + re-QA, commit, push, continue
  3. Run review-work      → Gate B (the reviewer subagents)
  4. If review fails      → back to Phase 1: fix blocking issues + re-QA, commit, push, continue
  5. Check Cubic          → Gate C
  6. If Cubic has issues   → back to Phase 1: fix + re-QA, commit, push, continue
  7. If Cubic quota out    → record Gate C SKIPPED, stop waiting on it
  8. All active gates pass → break
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

Read the logs, then fix per the iteration discipline below.

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

**On failure**: review-work reports blocking issues with specific files and line numbers. Fix each blocking issue per the iteration discipline below.

### Gate C: Cubic Approval

Cubic (`cubic-dev-ai[bot]`) is an automated review bot that comments on PRs. It does NOT use GitHub's APPROVED review state — instead it posts comments with issue counts and confidence scores.

**Approval signal**: The latest Cubic comment contains `**No issues found**` and confidence `**5/5**`.

**Issue signal**: The comment lists issues with file-level detail.

**Quota-exhausted signal**: Cubic posts a usage/quota/limit message instead of a review, or no Cubic review appears within the bounded wait below. This is the ONLY case where you skip Gate C and proceed — record it as SKIPPED in the final report, never silently. Issues are never a reason to skip.

```bash
# Get the latest Cubic review
CUBIC_REVIEW=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
  --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .body')

if echo "$CUBIC_REVIEW" | grep -q "No issues found"; then
  echo "Cubic: APPROVED"
elif echo "$CUBIC_REVIEW" | grep -qiE "quota|usage limit|rate limit|out of (credits|reviews)|upgrade your plan"; then
  echo "Cubic: SKIPPED (quota exhausted)"   # Gate C satisfied-by-skip; do not loop on it
else
  echo "Cubic: ISSUES FOUND"
  echo "$CUBIC_REVIEW"
fi
```

**On issues**: Cubic's review body contains structured issue descriptions. Parse them, determine which are valid (some may be false positives), and fix the valid ones per the iteration discipline below.

Cubic reviews are triggered automatically on PR updates. After pushing a fix, wait for the new review to appear before checking again. Use `gh api` polling with a conditional loop:

```bash
# Wait for a NEW Cubic review after push. If none arrives within the bound,
# Cubic is out of quota (or not running) → skip Gate C rather than spin forever.
PUSH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for _ in $(seq 1 30); do
  LATEST_REVIEW_TIME=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
    --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .submitted_at')
  [[ "$LATEST_REVIEW_TIME" > "$PUSH_TIME" ]] && break
  timeout 20 gh pr checks "$PR_NUMBER" --watch >/dev/null 2>&1 || true  # spend the interval usefully
done
# Loop exhausted without a newer review → treat Gate C as SKIPPED (quota exhausted)
[[ "$LATEST_REVIEW_TIME" > "$PUSH_TIME" ]] || echo "Cubic: SKIPPED (no review within bound — quota exhausted)"
```

### Iteration discipline

Each iteration through the loop:
1. Fix ONLY the issues identified by the failing gate
2. If the fix changes runtime behavior, capture fresh manual-QA evidence (Phase 1)
3. Commit atomically (one logical fix per commit)
4. Push
5. Re-enter from Gate A (code changed → full re-verification)

Avoid the temptation to "improve" unrelated code during fix iterations. Scope creep in the fix loop makes debugging harder and can introduce new failures.

</verify_loop>

---

## Phase 4: Merge & Cleanup

Once all active gates pass (Cubic may be SKIPPED on quota):

<merge_cleanup>

### Merge the PR

Merging is the default — do it unless the user explicitly told you not to. If they opted out, skip this step and report the green, ready-to-merge PR, but STILL run the cleanup below: the worktree is removed either way.

```bash
# This repository requires merge commits. Never use --squash or --rebase here.
gh pr merge "$PR_NUMBER" --merge --delete-branch
```

### Sync .omo state back to main repo

Before removing the worktree, copy `.omo/` state back. When `.omo/` is gitignored, files written there during worktree execution are not committed or merged — they would be lost on worktree removal.

```bash
# Sync .omo state from worktree to main repo (preserves task state, plans, notepads)
if [ -d "$WORKTREE_PATH/.omo" ]; then
  mkdir -p "$ORIGINAL_DIR/.omo"
  cp -r "$WORKTREE_PATH/.omo/"* "$ORIGINAL_DIR/.omo/" 2>/dev/null || true
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
## PR Complete

- **PR**: #{PR_NUMBER} — {PR_TITLE}
- **Branch**: {BRANCH_NAME} → {BASE_BRANCH}
- **Iterations**: {N} verification loops
- **Gates**: CI pass | review-work pass | Cubic {pass | SKIPPED (quota exhausted)}
- **Merged**: {yes | no — left for you to merge, as requested}
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
| Committing or pushing without manual-QA evidence on disk | "Tests pass" never proves the feature works; the repo forbids it for OpenCode/Codex-touching changes | CRITICAL |
| Pushing directly to dev/master | Bypasses review entirely | CRITICAL |
| Skipping CI gate after code changes | review-work and Cubic may pass on stale code | CRITICAL |
| Skipping Cubic because it found issues | Only an exhausted quota justifies a skip; real issues must be fixed and re-pushed | HIGH |
| Fixing unrelated code during verification loop | Scope creep causes new failures | HIGH |
| Deleting worktree on failure | User loses ability to inspect/resume | HIGH |
| Ignoring Cubic false positives without justification | Cubic issues should be evaluated, not blindly dismissed | MEDIUM |
| Giant single commits | Harder to isolate failures, violates git-master principles | MEDIUM |
| Not running local checks before push | Wastes CI time on obvious failures | MEDIUM |
