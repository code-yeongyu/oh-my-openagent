---
name: github-triage
description: "Read-only GitHub triage for issues AND PRs. 1 item = 1 background task (category: quick). Analyzes all open items and writes evidence-backed reports to /tmp/{datetime}/. Every claim requires a GitHub permalink as proof. NEVER takes any action on GitHub - no comments, no merges, no closes, no labels. Reports only. Triggers: 'triage', 'triage issues', 'triage PRs', 'github triage'."
---

# GitHub Triage - Read-Only Analyzer

<role>
Read-only GitHub triage orchestrator. Fetch open issues/PRs, classify, spawn 1 background `quick` subagent per item. Each subagent analyzes and writes a report file. ZERO GitHub mutations.
</role>

## Architecture

**1 ISSUE/PR = 1 `task_create` = 1 `quick` SUBAGENT (background). NO EXCEPTIONS.**

| Rule | Value |
|------|-------|
| Category | `quick` |
| Execution | `run_in_background=true` |
| Parallelism | ALL items simultaneously |
| Tracking | `task_create` per item |
| Output | `/tmp/{YYYYMMDD-HHmmss}/issue-{N}.md` or `pr-{N}.md` |

---

## Zero-Action Policy (ABSOLUTE)

<zero_action>
Subagents MUST NEVER run ANY command that writes or mutates GitHub state.

**FORBIDDEN** (non-exhaustive):
`gh issue comment`, `gh issue close`, `gh issue edit`, `gh pr comment`, `gh pr merge`, `gh pr review`, `gh pr edit`, `gh api -X POST`, `gh api -X PUT`, `gh api -X PATCH`, `gh api -X DELETE`

**ALLOWED**:
- `gh issue view`, `gh pr view`, `gh api` (GET only) - read GitHub data
- `Grep`, `Read`, `Glob` - read codebase
- `Write` - write report files to `/tmp/` ONLY
- `git log`, `git show`, `git blame` - read git history (for finding fix commits)

**ANY GitHub mutation = CRITICAL violation.**
</zero_action>

---

## Evidence Rule (MANDATORY)

<evidence>
**Every factual claim in a report MUST include a GitHub permalink as proof.**

A permalink is a URL pointing to a specific line/range in a specific commit, e.g.:
`https://github.com/{owner}/{repo}/blob/{commit_sha}/{path}#L{start}-L{end}`

### How to generate permalinks

1. Find the relevant file and line(s) via Grep/Read.
2. Get the current commit SHA: `git rev-parse HEAD`
3. Construct: `https://github.com/{REPO}/blob/{SHA}/{filepath}#L{line}` (or `#L{start}-L{end}` for ranges)

### Rules

- **No permalink = no claim.** If you cannot back a statement with a permalink, state "No evidence found" instead.
- Claims without permalinks are explicitly marked `[UNVERIFIED]` and carry zero weight.
- Permalinks to `main`/`master`/`dev` branches are NOT acceptable - use commit SHAs only.
- For bug analysis: permalink to the problematic code. For fix verification: permalink to the fixing commit diff.
</evidence>

---

## Phase 0: Setup

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPORT_DIR="/tmp/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$REPORT_DIR"
COMMIT_SHA=$(git rev-parse HEAD)
```

Pass `REPO`, `REPORT_DIR`, and `COMMIT_SHA` to every subagent.

---

## Phase 1: Fetch All Open Items

<fetch>
Paginate if 500 results returned.

```bash
ISSUES=$(gh issue list --repo $REPO --state open --limit 500 \
  --json number,title,state,createdAt,updatedAt,labels,author,body,comments)
ISSUE_LEN=$(echo "$ISSUES" | jq length)
if [ "$ISSUE_LEN" -eq 500 ]; then
  LAST_DATE=$(echo "$ISSUES" | jq -r '.[-1].createdAt')
  while true; do
    PAGE=$(gh issue list --repo $REPO --state open --limit 500 \
      --search "created:<$LAST_DATE" \
      --json number,title,state,createdAt,updatedAt,labels,author,body,comments)
    PAGE_LEN=$(echo "$PAGE" | jq length)
    [ "$PAGE_LEN" -eq 0 ] && break
    ISSUES=$(echo "[$ISSUES, $PAGE]" | jq -s 'add | unique_by(.number)')
    [ "$PAGE_LEN" -lt 500 ] && break
    LAST_DATE=$(echo "$PAGE" | jq -r '.[-1].createdAt')
  done
fi

PRS=$(gh pr list --repo $REPO --state open --limit 500 \
  --json number,title,state,createdAt,updatedAt,labels,author,body,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup)
PR_LEN=$(echo "$PRS" | jq length)
if [ "$PR_LEN" -eq 500 ]; then
  LAST_DATE=$(echo "$PRS" | jq -r '.[-1].createdAt')
  while true; do
    PAGE=$(gh pr list --repo $REPO --state open --limit 500 \
      --search "created:<$LAST_DATE" \
      --json number,title,state,createdAt,updatedAt,labels,author,body,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup)
    PAGE_LEN=$(echo "$PAGE" | jq length)
    [ "$PAGE_LEN" -eq 0 ] && break
    PRS=$(echo "[$PRS, $PAGE]" | jq -s 'add | unique_by(.number)')
    [ "$PAGE_LEN" -lt 500 ] && break
    LAST_DATE=$(echo "$PAGE" | jq -r '.[-1].createdAt')
  done
fi
```
</fetch>

---

## Phase 2: Classify

| Type | Detection |
|------|-----------|
| `ISSUE_QUESTION` | `[Question]`, `[Discussion]`, `?`, "how to" / "why does" / "is it possible" |
| `ISSUE_BUG` | `[Bug]`, `Bug:`, error messages, stack traces, unexpected behavior |
| `ISSUE_FEATURE` | `[Feature]`, `[RFE]`, `[Enhancement]`, `Feature Request`, `Proposal` |
| `ISSUE_OTHER` | Anything else |
| `PR_BUGFIX` | Title starts with `fix`, branch contains `fix/`/`bugfix/`, label `bug` |
| `PR_OTHER` | Everything else |

---

## Phase 3: Spawn Subagents (Individual Tool Calls)

**CRITICAL: Create tasks ONE BY ONE using individual `task_create` tool calls. NEVER batch or script.**

For each item, execute these steps sequentially:

### Step 3.1: Create Task Record
```typescript
task_create(
  subject="Triage: #{number} {title}",
  description="GitHub {issue|PR} triage analysis - {type}",
  metadata={"type": "{ISSUE_QUESTION|ISSUE_BUG|ISSUE_FEATURE|ISSUE_OTHER|PR_BUGFIX|PR_OTHER}", "number": {number}}
)
```

### Step 3.2: Spawn Analysis Subagent (Background)
```typescript
task(
  category="quick",
  run_in_background=true,
  load_skills=[],
  prompt=SUBAGENT_PROMPT
)
```

**ABSOLUTE RULES for Subagents:**
- **ONLY ANALYZE** - Never take action on GitHub (no comments, merges, closes)
- **READ-ONLY** - Use tools only for reading code/GitHub data
- **WRITE REPORT ONLY** - Output goes to `{REPORT_DIR}/{issue|pr}-{number}.md` via Write tool
- **EVIDENCE REQUIRED** - Every claim must have GitHub permalink as proof

```
For each item:
  1. task_create(subject="Triage: #{number} {title}")
  2. task(category="quick", run_in_background=true, load_skills=[], prompt=SUBAGENT_PROMPT)
  3. Store mapping: item_number -> { task_id, background_task_id }
```

---

## Subagent Prompts

### Common Preamble (include in ALL subagent prompts)

```
CONTEXT:
- Repository: {REPO}
- Report directory: {REPORT_DIR}
- Current commit SHA: {COMMIT_SHA}

PERMALINK FORMAT:
Every factual claim MUST include a permalink: https://github.com/{REPO}/blob/{COMMIT_SHA}/{filepath}#L{start}-L{end}
No permalink = no claim. Mark unverifiable claims as [UNVERIFIED].
To get current SHA if needed: git rev-parse HEAD

ABSOLUTE RULES (violating ANY = critical failure):
- NEVER run gh issue comment, gh issue close, gh issue edit
- NEVER run gh pr comment, gh pr merge, gh pr review, gh pr edit
- NEVER run any gh command with -X POST, -X PUT, -X PATCH, -X DELETE
- NEVER run git checkout, git fetch, git pull, git switch, git worktree
- Your ONLY writable output: {REPORT_DIR}/{issue|pr}-{number}.md via the Write tool
```


---

### ISSUE_QUESTION

```
You are analyzing issue #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. Understand the question.
2. Search the codebase (Grep, Read) for the answer.
3. For every finding, construct a permalink: https://github.com/{REPO}/blob/{COMMIT_SHA}/{path}#L{N}
4. Write report to {REPORT_DIR}/issue-{number}.md

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Question | **Author:** {author} | **Created:** {createdAt}

## Question
[1-2 sentence summary]

## Findings
[Each finding with permalink proof. Example:]
- The config is parsed in [`src/config/loader.ts#L42-L58`](https://github.com/{REPO}/blob/{SHA}/src/config/loader.ts#L42-L58)

## Suggested Answer
[Draft answer with code references and permalinks]

## Confidence: [HIGH | MEDIUM | LOW]
[Reason. If LOW: what's missing]

## Recommended Action
[What maintainer should do]

---
REMEMBER: No permalink = no claim. Every code reference needs a permalink.
```

---

### ISSUE_BUG

```
You are analyzing bug report #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. Understand: expected behavior, actual behavior, reproduction steps.
2. Search the codebase for relevant code. Trace the logic.
3. Determine verdict: CONFIRMED_BUG, NOT_A_BUG, ALREADY_FIXED, or UNCLEAR.
4. For ALREADY_FIXED: find the fixing commit using git log/git blame. Include the commit SHA and what changed.
5. For every finding, construct a permalink.
6. Write report to {REPORT_DIR}/issue-{number}.md

FINDING "ALREADY_FIXED" COMMITS:
- Use `git log --all --oneline -- {file}` to find recent changes to relevant files
- Use `git log --all --grep="fix" --grep="{keyword}" --all-match --oneline` to search commit messages
- Use `git blame {file}` to find who last changed the relevant lines
- Use `git show {commit_sha}` to verify the fix
- Construct commit permalink: https://github.com/{REPO}/commit/{fix_commit_sha}

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Bug Report | **Author:** {author} | **Created:** {createdAt}

## Bug Summary
**Expected:** [what user expects]
**Actual:** [what actually happens]
**Reproduction:** [steps if provided]

## Verdict: [CONFIRMED_BUG | NOT_A_BUG | ALREADY_FIXED | UNCLEAR]

## Analysis

### Evidence
[Each piece of evidence with permalink. No permalink = mark [UNVERIFIED]]

### Root Cause (if CONFIRMED_BUG)
[Which file, which function, what goes wrong]
- Problematic code: [`{path}#L{N}`](permalink)

### Why Not A Bug (if NOT_A_BUG)
[Rigorous proof with permalinks that current behavior is correct]

### Fix Details (if ALREADY_FIXED)
- **Fixed in commit:** [`{short_sha}`](https://github.com/{REPO}/commit/{full_sha})
- **Fixed date:** {date}
- **What changed:** [description with diff permalink]
- **Fixed by:** {author}

### Blockers (if UNCLEAR)
[What prevents determination, what to investigate next]

## Severity: [LOW | MEDIUM | HIGH | CRITICAL]

## Affected Files
[List with permalinks]

## Suggested Fix (if CONFIRMED_BUG)
[Specific approach: "In {file}#L{N}, change X to Y because Z"]

## Recommended Action
[What maintainer should do]

---
CRITICAL: Claims without permalinks are worthless. If you cannot find evidence, say so explicitly rather than making unverified claims.
```

---

### ISSUE_FEATURE

```
You are analyzing feature request #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK:
1. Understand the request.
2. Search codebase for existing (partial/full) implementations.
3. Assess feasibility.
4. Write report to {REPORT_DIR}/issue-{number}.md

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** Feature Request | **Author:** {author} | **Created:** {createdAt}

## Request Summary
[What the user wants]

## Existing Implementation: [YES_FULLY | YES_PARTIALLY | NO]
[If exists: where, with permalinks to the implementation]

## Feasibility: [EASY | MODERATE | HARD | ARCHITECTURAL_CHANGE]

## Relevant Files
[With permalinks]

## Implementation Notes
[Approach, pitfalls, dependencies]

## Recommended Action
[What maintainer should do]
```

---

### ISSUE_OTHER

```
You are analyzing issue #{number} for {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

TASK: Assess and write report to {REPORT_DIR}/issue-{number}.md

REPORT FORMAT (write this as the file content):

# Issue #{number}: {title}
**Type:** [QUESTION | BUG | FEATURE | DISCUSSION | META | STALE]
**Author:** {author} | **Created:** {createdAt}

## Summary
[1-2 sentences]

## Needs Attention: [YES | NO]
## Suggested Label: [if any]
## Recommended Action: [what maintainer should do]
```

---

### PR_BUGFIX

```
You are reviewing PR #{number} for {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName} <- Head: {headRefName}
- Draft: {isDraft} | Mergeable: {mergeable}
- Review: {reviewDecision} | CI: {statusCheckRollup_summary}
- Body: {body}

TASK:
1. Fetch PR details (READ-ONLY): gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. Read diff: gh api repos/{REPO}/pulls/{number}/files
3. Search codebase to verify fix correctness.
4. Write report to {REPORT_DIR}/pr-{number}.md

REPORT FORMAT (write this as the file content):

# PR #{number}: {title}
**Type:** Bugfix | **Author:** {author}
**Base:** {baseRefName} <- {headRefName} | **Draft:** {isDraft}

## Fix Summary
[What bug, how fixed - with permalinks to changed code]

## Code Review

### Correctness
[Is fix correct? Root cause addressed? Evidence with permalinks]

### Side Effects
[Risky changes, breaking changes - with permalinks if any]

### Code Quality
[Style, patterns, test coverage]

## Merge Readiness

| Check | Status |
|-------|--------|
| CI | [PASS / FAIL / PENDING] |
| Review | [APPROVED / CHANGES_REQUESTED / PENDING / NONE] |
| Mergeable | [YES / NO / CONFLICTED] |
| Draft | [YES / NO] |
| Correctness | [VERIFIED / CONCERNS / UNCLEAR] |
| Risk | [NONE / LOW / MEDIUM / HIGH] |

## Files Changed
[List with brief descriptions]

## Recommended Action: [MERGE | REQUEST_CHANGES | NEEDS_REVIEW | WAIT]
[Reasoning with evidence]

---
NEVER merge. NEVER comment. NEVER review. Write to file ONLY.
```

---

### PR_OTHER

```
You are reviewing PR #{number} for {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName} <- Head: {headRefName}
- Draft: {isDraft} | Mergeable: {mergeable}
- Review: {reviewDecision} | CI: {statusCheckRollup_summary}
- Body: {body}

TASK:
1. Fetch PR details (READ-ONLY): gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. Read diff: gh api repos/{REPO}/pulls/{number}/files
3. Write report to {REPORT_DIR}/pr-{number}.md

REPORT FORMAT (write this as the file content):

# PR #{number}: {title}
**Type:** [FEATURE | REFACTOR | DOCS | CHORE | TEST | OTHER]
**Author:** {author}
**Base:** {baseRefName} <- {headRefName} | **Draft:** {isDraft}

## Summary
[2-3 sentences with permalinks to key changes]

## Status

| Check | Status |
|-------|--------|
| CI | [PASS / FAIL / PENDING] |
| Review | [APPROVED / CHANGES_REQUESTED / PENDING / NONE] |
| Mergeable | [YES / NO / CONFLICTED] |
| Risk | [LOW / MEDIUM / HIGH] |
| Alignment | [YES / NO / UNCLEAR] |

## Files Changed
[Count and key files]

## Blockers
[If any]

## Recommended Action: [MERGE | REQUEST_CHANGES | NEEDS_REVIEW | CLOSE | WAIT]
[Reasoning]

---
NEVER merge. NEVER comment. NEVER review. Write to file ONLY.
```

---

## Phase 4: Collect & Update

Poll `background_output()` per task. As each completes:
1. Parse report.
2. `task_update(id=task_id, status="completed", description=REPORT_SUMMARY)`
3. Stream to user immediately.

---

## Phase 5: Final Summary

Write to `{REPORT_DIR}/SUMMARY.md` AND display to user:

```markdown
# GitHub Triage Report - {REPO}

**Date:** {date} | **Commit:** {COMMIT_SHA}
**Items Processed:** {total}
**Report Directory:** {REPORT_DIR}

## Issues ({issue_count})
| Category | Count |
|----------|-------|
| Bug Confirmed | {n} |
| Bug Already Fixed | {n} |
| Not A Bug | {n} |
| Needs Investigation | {n} |
| Question Analyzed | {n} |
| Feature Assessed | {n} |
| Other | {n} |

## PRs ({pr_count})
| Category | Count |
|----------|-------|
| Bugfix Reviewed | {n} |
| Other PR Reviewed | {n} |

## Items Requiring Attention
[Each item: number, title, verdict, 1-line summary, link to report file]

## Report Files
[All generated files with paths]
```

---

## Anti-Patterns

| Violation | Severity |
|-----------|----------|
| ANY GitHub mutation (comment/close/merge/review/label/edit) | **CRITICAL** |
| Claim without permalink | **CRITICAL** |
| Using category other than `quick` | CRITICAL |
| Batching multiple items into one task | CRITICAL |
| `run_in_background=false` | CRITICAL |
| `git checkout` on PR branch | CRITICAL |
| Guessing without codebase evidence | HIGH |
| Not writing report to `{REPORT_DIR}` | HIGH |
| Using branch name instead of commit SHA in permalink | HIGH |
