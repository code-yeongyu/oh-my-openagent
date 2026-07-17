---
name: work-with-pr
description: "Full PR lifecycle in a fresh task-owned git worktree: implement via the ulw-loop skill with mandatory evidence-bound manual QA → reviewer-readable English PR → verification loop (CI + Cubic, where Cubic is skipped only when its quota is exhausted) → merge by default → worktree cleanup. Decomposes one task into the smallest atomic, independently-mergeable PRs and builds the independent ones concurrently via one worktree per PR driven by parallel subagents or a team. Unbounded loop: any failing gate sends you back to fix-and-re-QA inside that PR's worktree. Use whenever implementation work needs to land as a PR. Triggers: 'create a PR', 'implement and PR', 'work on this and make a PR', 'implement issue', 'land this as a PR', 'split into atomic PRs', 'parallel PRs', 'work-with-pr', 'PR workflow', 'implement end to end', even when user just says 'implement X' if the context implies PR delivery."
---

# Work With PR — Full PR Lifecycle

You are executing a complete PR lifecycle: from fresh task-owned worktree setup, through `ulw-loop`-driven implementation with evidence-bound manual QA, PR creation, and an unbounded verification loop until the PR is merged. The loop has two gates — CI and Cubic — and a failing gate sends you back into that PR's worktree to fix and re-QA. You keep cycling until every active gate passes at once.

**The unit of delivery is the smallest PR that compiles, passes, and stands on its own — not "one task, one PR."** A single task routinely splits into several atomic PRs; the lifecycle below describes ONE of them, so apply it to each, and build the independent ones concurrently (Phase 0).

<architecture>

```
Phase 0: Setup         → Split into atomic PRs, then branch + worktree per PR (parallel when independent)
Phase 1: Implement     → Drive the work through the ulw-loop skill:
                         evidence-bound manual QA per success criterion, atomic commits
Phase 2: PR Creation   → Push, create a reviewer-readable English PR targeting dev
Phase 3: Verify Loop   → Unbounded iteration; a failing gate routes back to Phase 1:
  ├─ Gate A: CI         → gh pr checks (bun test, typecheck, build)
  └─ Gate B: Cubic      → cubic-dev-ai[bot] "No issues found"
                         (SKIPPED, not failed, when Cubic's quota is exhausted)
Phase 4: Merge         → Auto-merge by default; wait until actually merged, then worktree cleanup
```

</architecture>

---

## Phase 0: Setup

Create a fresh isolated worktree for each PR before implementation starts. The user's main working directory is read-only context — it may have uncommitted work, and a branch checkout would destroy it. Isolation also makes parallelism cheap: one worktree per PR, so several build at once without colliding.

<setup>

### 1. Decide the PR split

Before creating anything, decompose the task into the smallest atomic PRs that each compile, pass, and deliver one reviewable slice. Prefer more small PRs over one large one — a 200-line PR gets a real review; a 2000-line PR gets a rubber stamp. Sequence by dependency: independent slices branch off the base and run in parallel; dependent slices stack, each branched off the previous.

Building more than one independent PR concurrently is the recommended default, not an exotic option:
- **Subagents** — dispatch one background subagent per PR, each owning its own worktree, branch, and the full Phase 0→4 lifecycle.
- **Team** — for larger fan-outs, form a team (`team_mode`) and assign one member per PR.

When the work is large enough to need a plan (`ulw-plan`), this decomposition is not optional polish: the plan MUST encode the atomic PRs, their dependency order, and which run in parallel as first-class structure.

### 2. Resolve repository context

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPO_NAME=$(basename "$PWD")
BASE_BRANCH="dev"  # CI blocks PRs to master
```

### 3. Create branch

If user provides a branch name, use it. Otherwise, derive from the task:

```bash
# Auto-generate: feature/short-description or fix/short-description
BRANCH_NAME="feature/$(echo "$TASK_SUMMARY" | tr '[:upper:] ' '[:lower:]-' | head -c 50)"
git fetch origin "$BASE_BRANCH"
git branch "$BRANCH_NAME" "origin/$BASE_BRANCH"
```

### 4. Create worktree

Place worktrees as siblings to the repo — not inside it. This avoids git nested repo issues and keeps the working tree clean.

```bash
WORKTREE_PATH="../${REPO_NAME}-wt/${BRANCH_NAME}"
mkdir -p "$(dirname "$WORKTREE_PATH")"
git worktree add "$WORKTREE_PATH" "$BRANCH_NAME"
```

### 5. Set working context

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

Within each PR, stay minimal: deliver its one slice, add the test, prove it, stop. Do not refactor surrounding code, add config options, or "improve" things that aren't broken — that work belongs in its own PR, and scope creep makes failures harder to isolate.

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

Write the PR body in English for a human reviewer who has not followed the implementation thread. It must explain the work in plain terms, group changes by reviewer-relevant area instead of dumping files, and make QA evidence auditable without forcing the reviewer to guess what each log proves. Cite sanitized artifacts; do not paste raw secret-bearing logs, env dumps, tokens, auth headers, or private credentials into the PR.

If the PR body needs screenshots or terminal PNGs, follow `docs/reference/github-attachment-upload.md`: upload via GitHub user attachments from an authenticated web session, include only the final `https://github.com/user-attachments/assets/<uuid>` URLs, and never commit temporary images, use release assets, use external hosts, or log cookies/tokens.

```bash
gh pr create \
  --base "$BASE_BRANCH" \
  --head "$BRANCH_NAME" \
  --title "$PR_TITLE" \
  --body "$(cat <<'EOF'
## Summary
[2-4 sentences in plain language: what changed, why it changed, and how observable behavior is different after this PR.]

## Changes
[Group bullets by reviewer-relevant area, not by file. Each bullet should say what changed and how a reviewer can map it to the diff.]

## QA & Evidence
For each automated command or manual QA action:
- **What was tested:** [command or surface driven, with the behavior it was meant to prove]
- **Observed result:** [actual result, including before/after when relevant]
- **Artifact:** [`path/to/sanitized-log-or-report`]
- **Why sufficient:** [which risk or success criterion this evidence covers]

## Risks & Residuals
[Map each meaningful risk to the evidence above and state the conclusion: mitigated, accepted, or blocked. Include unavailable gates here with the concrete reason.]

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

This is the core of the skill. Every active gate must pass for the PR to be ready. The loop has no iteration cap — keep going until done. Gate ordering is intentional: CI is cheapest/fastest; Cubic is external and asynchronous. Gate B (Cubic) is the one gate that can be SKIPPED rather than satisfied — only when its quota is exhausted; it is never skipped just because it found issues. A failing gate is not a patch-and-push: route back to Phase 1, where fixes get the same scope discipline and, if behavior changed, fresh manual-QA evidence before you re-enter the loop.

<verify_loop>

```
while true:
  1. Wait for CI          → Gate A
  2. If CI fails          → back to Phase 1: read logs, fix + re-QA, commit, push, continue
  3. Check Cubic          → Gate B
  4. If Cubic has issues   → back to Phase 1: fix + re-QA, commit, push, continue
  5. If Cubic quota out    → record Gate B SKIPPED, stop waiting on it
  6. All active gates pass → break
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

### Gate B: Cubic Approval

Cubic (`cubic-dev-ai[bot]`) is an automated review bot that comments on PRs. It does NOT use GitHub's APPROVED review state — instead it posts comments with issue counts and confidence scores.

**Approval signal**: The latest Cubic comment contains `**No issues found**` and confidence `**5/5**`.

**Issue signal**: The comment lists issues with file-level detail.

**Quota-exhausted signal**: Cubic posts a usage/quota/limit message instead of a review, or no Cubic review appears within the bounded wait below. This is the ONLY case where you skip Gate B and proceed — record it as SKIPPED in the final report, never silently. Issues are never a reason to skip.

```bash
# Get the latest Cubic review
CUBIC_REVIEW=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
  --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .body')

if echo "$CUBIC_REVIEW" | grep -q "No issues found"; then
  echo "Cubic: APPROVED"
elif echo "$CUBIC_REVIEW" | grep -qiE "quota|usage limit|rate limit|out of (credits|reviews)|upgrade your plan"; then
  echo "Cubic: SKIPPED (quota exhausted)"   # Gate B satisfied-by-skip; do not loop on it
else
  echo "Cubic: ISSUES FOUND"
  echo "$CUBIC_REVIEW"
fi
```

**On issues**: Cubic's review body contains structured issue descriptions. Parse them, determine which are valid (some may be false positives), and fix the valid ones per the iteration discipline below.

Cubic reviews are triggered automatically on PR updates. After pushing a fix, wait for the new review to appear before checking again. Use `gh api` polling with a conditional loop:

```bash
# Wait for a NEW Cubic review after push. If none arrives within the bound,
# Cubic is out of quota (or not running) → skip Gate B rather than spin forever.
PUSH_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
for _ in $(seq 1 30); do
  LATEST_REVIEW_TIME=$(gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" \
    --jq '[.[] | select(.user.login == "cubic-dev-ai[bot]")] | last | .submitted_at')
  [[ "$LATEST_REVIEW_TIME" > "$PUSH_TIME" ]] && break
  timeout 20 gh pr checks "$PR_NUMBER" --watch >/dev/null 2>&1 || true  # spend the interval usefully
done
# Loop exhausted without a newer review → treat Gate B as SKIPPED (quota exhausted)
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

### Merge the PR (auto-merge by default)

Enabling auto-merge is the default - do it unless the user explicitly told you not to merge. Auto-merge hands the merge to GitHub, which lands the PR the moment every required gate is green, so you never sit and babysit checks. It does NOT bypass the gates: if a gate fails, GitHub will not merge, which routes you back to Phase 1 to fix and re-QA like any other failing gate.

```bash
# This repository requires merge commits. Never use --squash or --rebase.
# --auto arms auto-merge: GitHub merges as soon as all required checks pass.
gh pr merge "$PR_NUMBER" --merge --auto --delete-branch
# If the repo has not enabled the auto-merge feature, --auto errors; once the gates
# are green, fall back to a direct merge: gh pr merge "$PR_NUMBER" --merge --delete-branch
```

Then WAIT until the merge has actually completed before you report done or clean up - never walk away while the PR is still merging:

```bash
# Block until the PR is actually MERGED (auto-merge lands once all required checks pass)
until [ "$(gh pr view "$PR_NUMBER" --json state -q .state)" = "MERGED" ]; do
  gh pr checks "$PR_NUMBER" --watch --fail-fast >/dev/null 2>&1 || true   # spend the interval on the checks
done
```

If the user opted out of merging, skip the merge but STILL run the cleanup below: the worktree is removed either way.

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
- **Gates**: CI pass | Cubic {pass | SKIPPED (quota exhausted)}
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
| Skipping CI gate after code changes | Cubic may pass on stale code | CRITICAL |
| Skipping Cubic because it found issues | Only an exhausted quota justifies a skip; real issues must be fixed and re-pushed | HIGH |
| Fixing unrelated code during verification loop | Scope creep causes new failures | HIGH |
| Deleting worktree on failure | User loses ability to inspect/resume | HIGH |
| Ignoring Cubic false positives without justification | Cubic issues should be evaluated, not blindly dismissed | MEDIUM |
| Bundling independent slices into one big PR | Atomic review dies — a 2000-line PR gets rubber-stamped, regressions hide, and one bad slice blocks all the others | HIGH |
| Giant single commits | Harder to isolate failures, violates git-master principles | MEDIUM |
| Not running local checks before push | Wastes CI time on obvious failures | MEDIUM |
