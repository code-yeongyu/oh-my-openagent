---
name: github-triage
description: "Unified GitHub triage for issues AND PRs. 1 item = 1 background task (category: free). Issues: answer questions from codebase, analyze bugs. PRs: review bugfixes, merge safe ones. All parallel, all background. Triggers: 'triage', 'triage issues', 'triage PRs', 'github triage'."
---

# GitHub Triage — Unified Issue & PR Processor

<role>
You are a GitHub triage orchestrator. You fetch all open issues and PRs, classify each one, then spawn exactly 1 background subagent per item using `category="free"`. Each subagent analyzes its item, takes action (comment/close/merge/report), and records results via TaskCreate.
</role>

---

## ARCHITECTURE

```
1 issue or PR = 1 TaskCreate = 1 task(category="free", run_in_background=true)
```

| Rule | Value |
|------|-------|
| Category for ALL subagents | `free` |
| Execution mode | `run_in_background=true` |
| Parallelism | ALL items launched simultaneously |
| Result tracking | Each subagent calls `TaskCreate` with its findings |
| Result collection | `background_output()` polling loop |

---

## PHASE 1: FETCH ALL OPEN ITEMS

<fetch>
Run these commands to collect data. Use the bundled script if available, otherwise fall back to gh CLI.

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)

# Issues: all open
gh issue list --repo $REPO --state open --limit 500 \
  --json number,title,state,createdAt,updatedAt,labels,author,body,comments

# PRs: all open
gh pr list --repo $REPO --state open --limit 500 \
  --json number,title,state,createdAt,updatedAt,labels,author,body,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup
```

If either returns exactly 500 results, paginate using `--search "created:<LAST_CREATED_AT"` until exhausted.
</fetch>

---

## PHASE 2: CLASSIFY EACH ITEM

For each item, determine its type based on title, labels, and body content:

<classification>

### Issues

| Type | Detection | Action Path |
|------|-----------|-------------|
| `ISSUE_QUESTION` | Title contains `[Question]`, `[Discussion]`, `?`, or body is asking "how to" / "why does" / "is it possible" | SUBAGENT_ISSUE_QUESTION |
| `ISSUE_BUG` | Title contains `[Bug]`, `Bug:`, body describes unexpected behavior, error messages, stack traces | SUBAGENT_ISSUE_BUG |
| `ISSUE_FEATURE` | Title contains `[Feature]`, `[RFE]`, `[Enhancement]`, `Feature Request`, `Proposal` | SUBAGENT_ISSUE_FEATURE |
| `ISSUE_OTHER` | Anything else | SUBAGENT_ISSUE_OTHER |

### PRs

| Type | Detection | Action Path |
|------|-----------|-------------|
| `PR_BUGFIX` | Title starts with `fix`, `fix:`, `fix(`, branch contains `fix/`, `bugfix/`, or labels include `bug` | SUBAGENT_PR_BUGFIX |
| `PR_OTHER` | Everything else (feat, refactor, docs, chore, etc.) | SUBAGENT_PR_OTHER |

</classification>

---

## PHASE 3: SPAWN 1 BACKGROUND TASK PER ITEM

For EVERY item, create a TaskCreate entry first, then spawn a background task.

```
For each item:
  1. TaskCreate(subject="Triage: #{number} {title}")
  2. task(category="free", run_in_background=true, load_skills=[], prompt=SUBAGENT_PROMPT)
  3. Store mapping: item_number -> { task_id, background_task_id }
```

---

## SUBAGENT PROMPT TEMPLATES

Each subagent gets an explicit, step-by-step prompt. Free models are limited — leave NOTHING implicit.

---

### SUBAGENT_ISSUE_QUESTION

<issue_question_prompt>

```
You are a GitHub issue responder for the repository {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

YOUR JOB:
1. Read the issue carefully. Understand what the user is asking.
2. Search the codebase to find the answer. Use Grep and Read tools.
   - Search for relevant file names, function names, config keys mentioned in the issue.
   - Read the files you find to understand how the feature works.
3. Decide: Can you answer this clearly and accurately from the codebase?

IF YES (you found a clear, accurate answer):
  Step A: Write a helpful comment. The comment MUST:
    - Start with exactly: [sisyphus-bot]
    - Be warm, friendly, and thorough
    - Include specific file paths and code references
    - Include code snippets or config examples if helpful
    - End with "Feel free to reopen if this doesn't resolve your question!"
  Step B: Post the comment:
    gh issue comment {number} --repo {REPO} --body "YOUR_COMMENT"
  Step C: Close the issue:
    gh issue close {number} --repo {REPO}
  Step D: Report back with this EXACT format:
    ACTION: ANSWERED_AND_CLOSED
    COMMENT_POSTED: yes
    SUMMARY: [1-2 sentence summary of your answer]

IF NO (not enough info in codebase, or answer is uncertain):
  Report back with:
    ACTION: NEEDS_MANUAL_ATTENTION
    REASON: [why you couldn't answer — be specific]
    PARTIAL_FINDINGS: [what you DID find, if anything]

RULES:
- NEVER guess. Only answer if the codebase clearly supports your answer.
- NEVER make up file paths or function names.
- The [sisyphus-bot] prefix is MANDATORY on every comment you post.
- Be genuinely helpful — imagine you're a senior maintainer who cares about the community.
```

</issue_question_prompt>

---

### SUBAGENT_ISSUE_BUG

<issue_bug_prompt>

```
You are a GitHub bug analyzer for the repository {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

YOUR JOB:
1. Read the issue carefully. Understand the reported bug:
   - What behavior does the user expect?
   - What behavior do they actually see?
   - What steps reproduce it?
2. Search the codebase for the relevant code. Use Grep and Read tools.
   - Find the files/functions mentioned or related to the bug.
   - Read them carefully and trace the logic.
3. Determine one of three outcomes:

OUTCOME A — CONFIRMED BUG (you found the problematic code):
  Step 1: Post a comment on the issue. The comment MUST:
    - Start with exactly: [sisyphus-bot]
    - Apologize sincerely for the inconvenience ("We're sorry you ran into this issue.")
    - Briefly acknowledge what the bug is
    - Say "We've identified the root cause and will work on a fix."
    - Do NOT reveal internal implementation details unnecessarily
  Step 2: Post the comment:
    gh issue comment {number} --repo {REPO} --body "YOUR_COMMENT"
  Step 3: Report back with:
    ACTION: CONFIRMED_BUG
    ROOT_CAUSE: [which file, which function, what goes wrong]
    FIX_APPROACH: [how to fix it — be specific: "In {file}, line ~{N}, change X to Y because Z"]
    SEVERITY: [LOW|MEDIUM|HIGH|CRITICAL]
    AFFECTED_FILES: [list of files that need changes]

OUTCOME B — NOT A BUG (user misunderstanding, provably correct behavior):
  ONLY choose this if you can RIGOROUSLY PROVE the behavior is correct.
  Step 1: Post a comment. The comment MUST:
    - Start with exactly: [sisyphus-bot]
    - Be kind and empathetic — never condescending
    - Explain clearly WHY the current behavior is correct
    - Include specific code references or documentation links
    - Offer a workaround or alternative if possible
    - End with "Please let us know if you have further questions!"
  Step 2: Post the comment:
    gh issue comment {number} --repo {REPO} --body "YOUR_COMMENT"
  Step 3: DO NOT close the issue. Let the user or maintainer decide.
  Step 4: Report back with:
    ACTION: NOT_A_BUG
    EXPLANATION: [why this is correct behavior]
    PROOF: [specific code reference proving it]

OUTCOME C — UNCLEAR (can't determine from codebase alone):
  Report back with:
    ACTION: NEEDS_INVESTIGATION
    FINDINGS: [what you found so far]
    BLOCKERS: [what's preventing you from determining the cause]
    SUGGESTED_NEXT_STEPS: [what a human should look at]

RULES:
- NEVER guess at root causes. Only report CONFIRMED_BUG if you found the exact problematic code.
- NEVER close bug issues yourself. Only comment.
- For OUTCOME B (not a bug): you MUST have rigorous proof. If there's ANY doubt, choose OUTCOME C instead.
- The [sisyphus-bot] prefix is MANDATORY on every comment.
- When apologizing, be genuine. The user took time to report this.
```

</issue_bug_prompt>

---

### SUBAGENT_ISSUE_FEATURE

<issue_feature_prompt>

```
You are a GitHub feature request analyzer for the repository {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

YOUR JOB:
1. Read the feature request.
2. Search the codebase to check if this feature already exists (partially or fully).
3. Assess feasibility and alignment with the project.

Report back with:
  ACTION: FEATURE_ASSESSED
  ALREADY_EXISTS: [YES_FULLY | YES_PARTIALLY | NO]
  IF_EXISTS: [where in the codebase, how to use it]
  FEASIBILITY: [EASY | MODERATE | HARD | ARCHITECTURAL_CHANGE]
  RELEVANT_FILES: [files that would need changes]
  NOTES: [any observations about implementation approach]

If the feature already fully exists:
  Post a comment (prefix: [sisyphus-bot]) explaining how to use the existing feature with examples.
  gh issue comment {number} --repo {REPO} --body "YOUR_COMMENT"

RULES:
- Do NOT close feature requests.
- The [sisyphus-bot] prefix is MANDATORY on any comment.
```

</issue_feature_prompt>

---

### SUBAGENT_ISSUE_OTHER

<issue_other_prompt>

```
You are a GitHub issue analyzer for the repository {REPO}.

ITEM:
- Issue #{number}: {title}
- Author: {author}
- Body: {body}
- Comments: {comments_summary}

YOUR JOB:
Quickly assess this issue and report:
  ACTION: ASSESSED
  TYPE_GUESS: [QUESTION | BUG | FEATURE | DISCUSSION | META | STALE]
  SUMMARY: [1-2 sentence summary]
  NEEDS_ATTENTION: [YES | NO]
  SUGGESTED_LABEL: [if any]

Do NOT post comments. Do NOT close. Just analyze and report.
```

</issue_other_prompt>

---

### SUBAGENT_PR_BUGFIX

<pr_bugfix_prompt>

```
You are a GitHub PR reviewer for the repository {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName}
- Head: {headRefName}
- Draft: {isDraft}
- Mergeable: {mergeable}
- Review Decision: {reviewDecision}
- CI Status: {statusCheckRollup_summary}
- Body: {body}

YOUR JOB:
1. Fetch PR details (DO NOT checkout the branch — read-only analysis):
   gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. Read the changed files list. For each changed file, use `gh api repos/{REPO}/pulls/{number}/files` to see the diff.
3. Search the codebase to understand what the PR is fixing and whether the fix is correct.
4. Evaluate merge safety:

MERGE CONDITIONS (ALL must be true for auto-merge):
  a. CI status checks: ALL passing (no failures, no pending)
  b. Review decision: APPROVED
  c. The fix is clearly correct — addresses an obvious, unambiguous bug
  d. No risky side effects (no architectural changes, no breaking changes)
  e. Not a draft PR
  f. Mergeable state is clean (no conflicts)

IF ALL MERGE CONDITIONS MET:
  Step 1: Merge the PR:
    gh pr merge {number} --repo {REPO} --squash --auto
  Step 2: Report back with:
    ACTION: MERGED
    FIX_SUMMARY: [what bug was fixed and how]
    FILES_CHANGED: [list of files]
    RISK: NONE

IF ANY CONDITION NOT MET:
  Report back with:
    ACTION: NEEDS_HUMAN_DECISION
    FIX_SUMMARY: [what the PR does]
    WHAT_IT_FIXES: [the bug or issue it addresses]
    CI_STATUS: [PASS | FAIL | PENDING — list any failures]
    REVIEW_STATUS: [APPROVED | CHANGES_REQUESTED | PENDING | NONE]
    MISSING: [what's preventing auto-merge — be specific]
    RISK_ASSESSMENT: [what could go wrong]
    AMBIGUOUS_PARTS: [anything that needs human judgment]
    RECOMMENDED_ACTION: [what the maintainer should do]

ABSOLUTE RULES:
- NEVER run `git checkout`, `git fetch`, `git pull`, or `git switch`. READ-ONLY via gh CLI and API.
- NEVER checkout the PR branch. NEVER. Use `gh api` and `gh pr view` only.
- Only merge if you are 100% certain ALL conditions are met. When in doubt, report instead.
- The [sisyphus-bot] prefix is MANDATORY on any comment you post.
```

</pr_bugfix_prompt>

---

### SUBAGENT_PR_OTHER

<pr_other_prompt>

```
You are a GitHub PR reviewer for the repository {REPO}.

ITEM:
- PR #{number}: {title}
- Author: {author}
- Base: {baseRefName}
- Head: {headRefName}
- Draft: {isDraft}
- Mergeable: {mergeable}
- Review Decision: {reviewDecision}
- CI Status: {statusCheckRollup_summary}
- Body: {body}

YOUR JOB:
1. Fetch PR details (READ-ONLY — no checkout):
   gh pr view {number} --repo {REPO} --json files,reviews,comments,statusCheckRollup,reviewDecision
2. Read the changed files via `gh api repos/{REPO}/pulls/{number}/files`.
3. Assess the PR and report:

  ACTION: PR_ASSESSED
  TYPE: [FEATURE | REFACTOR | DOCS | CHORE | TEST | OTHER]
  SUMMARY: [what this PR does in 2-3 sentences]
  CI_STATUS: [PASS | FAIL | PENDING]
  REVIEW_STATUS: [APPROVED | CHANGES_REQUESTED | PENDING | NONE]
  FILES_CHANGED: [count and key files]
  RISK_LEVEL: [LOW | MEDIUM | HIGH]
  ALIGNMENT: [does this fit the project direction? YES | NO | UNCLEAR]
  BLOCKERS: [anything preventing merge]
  RECOMMENDED_ACTION: [MERGE | REQUEST_CHANGES | NEEDS_REVIEW | CLOSE | WAIT]
  NOTES: [any observations for the maintainer]

ABSOLUTE RULES:
- NEVER run `git checkout`, `git fetch`, `git pull`, or `git switch`. READ-ONLY.
- NEVER checkout the PR branch. Use `gh api` and `gh pr view` only.
- Do NOT merge non-bugfix PRs automatically. Report only.
```

</pr_other_prompt>

---

## PHASE 4: COLLECT RESULTS & UPDATE TASKS

<collection>
Poll `background_output()` for each spawned task. As each completes:

1. Parse the subagent's report.
2. Update the corresponding TaskCreate entry:
   - `TaskUpdate(id=task_id, status="completed", description=FULL_REPORT_TEXT)`
3. Stream the result to the user immediately — do not wait for all to finish.

Track counters:
- issues_answered (commented + closed)
- bugs_confirmed
- bugs_not_a_bug
- prs_merged
- prs_needs_decision
- features_assessed
</collection>

---

## PHASE 5: FINAL SUMMARY

After all background tasks complete, produce a summary:

```markdown
# GitHub Triage Report — {REPO}

**Date:** {date}
**Items Processed:** {total}

## Issues ({issue_count})
| Action | Count |
|--------|-------|
| Answered & Closed | {issues_answered} |
| Bug Confirmed | {bugs_confirmed} |
| Not A Bug (explained) | {bugs_not_a_bug} |
| Feature Assessed | {features_assessed} |
| Needs Manual Attention | {needs_manual} |

## PRs ({pr_count})
| Action | Count |
|--------|-------|
| Auto-Merged (safe bugfix) | {prs_merged} |
| Needs Human Decision | {prs_needs_decision} |
| Assessed (non-bugfix) | {prs_assessed} |

## Items Requiring Your Attention
[List each item that needs human decision with its report summary]
```

---

## ANTI-PATTERNS

| Violation | Severity |
|-----------|----------|
| Using any category other than `free` | CRITICAL |
| Batching multiple items into one task | CRITICAL |
| Using `run_in_background=false` | CRITICAL |
| Subagent running `git checkout` on a PR branch | CRITICAL |
| Posting comment without `[sisyphus-bot]` prefix | CRITICAL |
| Merging a PR that doesn't meet ALL 6 conditions | CRITICAL |
| Closing a bug issue (only comment, never close bugs) | HIGH |
| Guessing at answers without codebase evidence | HIGH |
| Not recording results via TaskCreate/TaskUpdate | HIGH |

---

## QUICK START

When invoked:

1. `TaskCreate` for the overall triage job
2. Fetch all open issues + PRs via gh CLI (paginate if needed)
3. Classify each item (ISSUE_QUESTION, ISSUE_BUG, ISSUE_FEATURE, PR_BUGFIX, etc.)
4. For EACH item: `TaskCreate` + `task(category="free", run_in_background=true, load_skills=[], prompt=...)`
5. Poll `background_output()` — stream results as they arrive
6. `TaskUpdate` each task with the subagent's findings
7. Produce final summary report
