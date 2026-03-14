# Execution Plan: Relax comment-checker "Note:" false positives

## Phase 0: Setup (Worktree + Branch)

1. Create worktree from `origin/dev`:
   ```bash
   git fetch origin dev
   git worktree add ../omo-wt/fix/comment-checker-note-false-positive origin/dev
   cd ../omo-wt/fix/comment-checker-note-false-positive
   git checkout -b fix/comment-checker-note-false-positive
   bun install
   ```

2. Verify clean build before touching anything:
   ```bash
   bun run typecheck && bun test && bun run build
   ```

## Phase 1: Implement

### Problem Analysis

The comment-checker delegates to an external Go binary (`code-yeongyu/go-claude-code-comment-checker` v0.4.1). The binary contains the regex `(?i)^[\s#/*-]*note:\s*\w` which matches ANY comment starting with "Note:" followed by a word character. This flags legitimate technical notes like:

- `// Note: Thread-safe by design`
- `# Note: See RFC 7231 for details`
- `// Note: This edge case requires special handling`

Full list of 24 embedded regex patterns extracted from the binary:

| Pattern | Purpose |
|---------|---------|
| `(?i)^[\s#/*-]*note:\s*\w` | **THE PROBLEM** - Matches all "Note:" comments |
| `(?i)^[\s#/*-]*added?\b` | Detects "add/added" |
| `(?i)^[\s#/*-]*removed?\b` | Detects "remove/removed" |
| `(?i)^[\s#/*-]*deleted?\b` | Detects "delete/deleted" |
| `(?i)^[\s#/*-]*replaced?\b` | Detects "replace/replaced" |
| `(?i)^[\s#/*-]*implemented?\b` | Detects "implement/implemented" |
| `(?i)^[\s#/*-]*previously\b` | Detects "previously" |
| `(?i)^[\s#/*-]*here\s+we\b` | Detects "here we" |
| `(?i)^[\s#/*-]*refactor(ed\|ing)?\b` | Detects "refactor" variants |
| `(?i)^[\s#/*-]*implementation\s+(of\|note)\b` | Detects "implementation of/note" |
| `(?i)^[\s#/*-]*this\s+(implements?\|adds?\|removes?\|changes?\|fixes?)\b` | Detects "this implements/adds/etc" |
| ... and 13 more migration/change patterns | |

### Approach

Since the regex lives in the Go binary and this repo wraps it, the fix is two-pronged:

**A. Go binary update** (separate repo: `code-yeongyu/go-claude-code-comment-checker`):
- Relax `(?i)^[\s#/*-]*note:\s*\w` to only match AI-style memo patterns like `Note: this was changed...`, `Note: implementation details...`
- Add `--exclude-pattern` CLI flag for user-configurable exclusions

**B. This repo (oh-my-opencode)** - the PR scope:
1. Add `exclude_patterns` config field to `CommentCheckerConfigSchema`
2. Pass `--exclude-pattern` flags to the CLI binary
3. Add integration tests with mock binaries for false positive scenarios

### Commit Plan (Atomic)

| # | Commit | Files |
|---|--------|-------|
| 1 | `feat(config): add exclude_patterns to comment-checker config` | `src/config/schema/comment-checker.ts` |
| 2 | `feat(comment-checker): pass exclude patterns to CLI binary` | `src/hooks/comment-checker/cli.ts`, `src/hooks/comment-checker/cli-runner.ts` |
| 3 | `test(comment-checker): add false positive test cases for Note: comments` | `src/hooks/comment-checker/cli.test.ts`, `src/hooks/comment-checker/hook.apply-patch.test.ts` |

### Local Validation (after each commit)

```bash
bun run typecheck
bun test src/hooks/comment-checker/
bun test src/config/
bun run build
```

## Phase 2: PR Creation

```bash
git push -u origin fix/comment-checker-note-false-positive
gh pr create --base dev \
  --title "fix(comment-checker): relax regex to stop flagging legitimate Note: comments" \
  --body-file /tmp/pr-body.md
```

## Phase 3: Verify Loop

### Gate A: CI
- Wait for `ci.yml` workflow (tests, typecheck, build)
- If CI fails: fix locally, amend or new commit, force push

### Gate B: review-work (5-agent)
- Run `/review-work` to trigger 5 parallel sub-agents:
  - Oracle (goal/constraint verification)
  - Oracle (code quality)
  - Oracle (security)
  - Hephaestus (hands-on QA execution)
  - Hephaestus (context mining)
- All 5 must pass

### Gate C: Cubic
- Wait for `cubic-dev-ai[bot]` review
- Must see "No issues found" comment
- If issues found: address feedback, push fix, re-request review

## Phase 4: Merge

```bash
gh pr merge --squash --auto
# Cleanup worktree
cd /Users/yeongyu/local-workspaces/omo
git worktree remove ../omo-wt/fix/comment-checker-note-false-positive
```
