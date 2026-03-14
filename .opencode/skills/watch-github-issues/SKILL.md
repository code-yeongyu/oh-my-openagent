---
name: watch-github-issues
description: "Persistent GitHub issue watcher. Periodically polls open issues, implements fixes/features, documents all changes in issue comments with permalinks, creates PRs, and responds to new comments from issue authors. Triggers: 'watch issues', 'watch github issues', 'monitor issues', 'issue watcher', 'track issues'."
---

# GitHub Issue Watcher - Persistent Monitor & Implementer

<role>
Persistent GitHub issue monitoring agent. Poll open issues on a loop, classify them, implement fixes or features, document all changes in issue comments with evidence-backed permalinks, create PRs, and continuously respond to new author comments. This is an ACTIVE agent - it makes real changes and communicates via issue comments.
</role>

## Architecture

**Continuous polling loop with state persistence.**

| Rule | Value |
|------|-------|
| Poll interval | 120 seconds (configurable) |
| State file | `/tmp/issue-watcher-{repo}-state.json` |
| Log file | `/tmp/issue-watcher-{repo}.log` |
| Branch prefix | `issue-watcher/` |
| Max concurrent | 1 issue at a time (sequential processing) |

---

## Phase 0: Initialization

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
REPO_SLUG=$(echo "$REPO" | tr '/' '-')
STATE_FILE="/tmp/issue-watcher-${REPO_SLUG}-state.json"
LOG_FILE="/tmp/issue-watcher-${REPO_SLUG}.log"
COMMIT_SHA=$(git rev-parse HEAD)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
```

### State File Structure

If the state file does not exist, create it:

```json
{
  "last_poll": null,
  "poll_count": 0,
  "tracked_issues": {}
}
```

Each tracked issue entry:

```json
{
  "42": {
    "title": "Bug in auth flow",
    "last_seen_comment_count": 3,
    "last_updated_at": "2025-01-15T10:00:00Z",
    "status": "monitoring",
    "branch": null,
    "pr_number": null,
    "actions_taken": []
  }
}
```

Status values: `monitoring` | `investigating` | `in_progress` | `pr_created` | `completed` | `skipped`

---

## Phase 1: Poll Loop

### 1.1 Fetch Open Issues

```bash
gh issue list --repo $REPO --state open --limit 100 \
  --json number,title,body,comments,labels,author,updatedAt,createdAt
```

### 1.2 Detect Changes

For each issue, compare with state:

| Condition | Action |
|-----------|--------|
| Issue not in state | New issue - classify and potentially act |
| `updatedAt` changed | Check for new comments |
| Comment count increased | New comment - parse and respond |
| Issue closed externally | Remove from tracking |

### 1.3 Classify Issues

| Signal | Classification | Priority |
|--------|---------------|----------|
| Label `bug`, body contains error/stack trace | BUG | HIGH |
| Label `enhancement`/`feature` | FEATURE | MEDIUM |
| Label `documentation`, body mentions docs/typo | DOCS | LOW |
| Label `good first issue` or `help wanted` | ACTIONABLE | HIGH |
| Label `question` or body ends with `?` | QUESTION | LOW |
| No clear signals | UNCLASSIFIED | LOW |

**Priority determines processing order within a poll cycle.**

---

## Phase 2: Issue Processing

For each actionable issue (highest priority first):

### 2.1 Investigation

1. Read the full issue body and all comments
2. Search the codebase for relevant files (Grep, Glob, AST-grep)
3. Understand the root cause or scope of requested change
4. Decide: can this be fixed/implemented safely?

Decision matrix:

| Confidence | Scope | Action |
|-----------|-------|--------|
| HIGH | Small (1-3 files) | Implement directly |
| HIGH | Large (4+ files) | Implement with caution, thorough testing |
| MEDIUM | Small | Implement, note uncertainty in comment |
| MEDIUM | Large | Comment analysis only, suggest approach |
| LOW | Any | Comment analysis only, ask for clarification |

### 2.2 Implementation

```bash
git checkout $DEFAULT_BRANCH
git pull origin $DEFAULT_BRANCH
ISSUE_NUM={number}
SAFE_TITLE=$(echo '{title}' | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | head -c 40)
BRANCH="issue-watcher/${ISSUE_NUM}-${SAFE_TITLE}"
git checkout -b "$BRANCH"
```

Make changes following these rules:
- Minimal, focused changes - only what the issue asks for
- Run existing tests after changes
- Run `lsp_diagnostics` on all changed files
- Commit with message referencing the issue: `fix: description (#ISSUE_NUM)`

### 2.3 Document in Issue

After any action (investigation or implementation), post a comment:

```bash
gh issue comment $ISSUE_NUM --repo $REPO --body "$(cat <<'EOF'
## Issue Watcher Report

**Status:** [Investigating | Fix Implemented | Analysis Complete | Needs Clarification]

### Analysis
[What was found, with permalinks to relevant code]

Example: The auth middleware at [`src/middleware/auth.ts#L42-L58`](https://github.com/{REPO}/blob/{SHA}/src/middleware/auth.ts#L42-L58) does not handle expired tokens.

### Changes Made
| File | Change | Permalink |
|------|--------|-----------|
| `src/auth.ts` | Fixed null check | [Link](permalink) |

### Test Results
- All existing tests pass
- [Any new test details]

### Branch & PR
- **Branch:** `{branch_name}`
- **PR:** #{pr_number} (if created)

---
*Automated by issue-watcher. Reply here to request changes or say "stop watching" to untrack.*
EOF
)"
```

### 2.4 Create PR

When implementation is ready:

```bash
gh pr create --repo $REPO \
  --title "fix: {concise description} (#${ISSUE_NUM})" \
  --body "$(cat <<'EOF'
Closes #{ISSUE_NUM}

## Changes
[Summary with permalinks]

## Testing
[Test results]

---
*Created by issue-watcher agent*
EOF
)" \
  --head "$BRANCH" \
  --base "$DEFAULT_BRANCH"
```

Update state with PR number.

---

## Phase 3: Comment Monitoring

On each poll, for every tracked issue with status != `completed` or `skipped`:

### 3.1 Check for New Comments

```bash
CURRENT_COMMENTS=$(gh issue view $ISSUE_NUM --repo $REPO --json comments --jq '.comments | length')
```

If `CURRENT_COMMENTS > last_seen_comment_count`:

### 3.2 Parse New Comments

Fetch the new comments:

```bash
gh issue view $ISSUE_NUM --repo $REPO --json comments \
  --jq ".comments | sort_by(.createdAt) | .[-$NEW_COUNT:]"
```

### 3.3 Classify Comment Intent

| Pattern in Comment | Intent | Action |
|-------------------|--------|--------|
| "stop watching", "untrack", "@bot stop" | STOP | Remove from tracking, acknowledge |
| "can you also", "please also", "additionally" | EXTEND | Make additional changes on same branch |
| "this doesn't", "still broken", "not working" | RETRY | Re-investigate with new info |
| "thanks", "LGTM", "looks good" | DONE | Mark completed |
| "what about", "have you considered" | QUESTION | Research and respond |
| "please update", "change X to Y" | MODIFY | Make specific requested change |

### 3.4 Act on Comment

1. Switch to the issue's working branch (or create one)
2. Make requested changes
3. Push changes
4. Reply to the issue with update details
5. Update state file

---

## Phase 4: Loop Control

```
LOOP:
  read_state()
  issues = fetch_open_issues()
  
  for issue in issues (sorted by priority):
    if is_new(issue):
      classify(issue)
      if is_actionable(issue):
        investigate(issue)
        implement_if_confident(issue)
        document_in_issue(issue)
        create_pr_if_ready(issue)
      track(issue)
    
    if has_new_comments(issue):
      for comment in new_comments(issue):
        intent = classify_comment(comment)
        act_on_intent(intent, issue, comment)
        reply_to_issue(issue)
  
  cleanup_completed_issues()
  save_state()
  
  log("Poll cycle complete. Next poll in ${POLL_INTERVAL}s")
  sleep(POLL_INTERVAL)
  goto LOOP
```

---

## State Management Rules

1. **Save after every action** - crash recovery depends on this
2. **Idempotent actions** - re-running after crash should not duplicate work
3. **Track all branches** - clean up branches for completed issues
4. **Preserve history** - `actions_taken` array logs what was done and when

---

## Error Handling

| Error | Recovery |
|-------|----------|
| API rate limit (403) | Exponential backoff: 2min, 4min, 8min, max 30min |
| Git merge conflict | Document in issue, ask human for help, mark `needs_attention` |
| Test failures after changes | Revert changes, document failure in issue, do NOT push |
| Network error | Retry 3 times with 10s delay, then skip to next poll |
| Unknown error | Log to file, skip current issue, continue loop |

---

## Anti-Patterns (VIOLATIONS)

| Violation | Severity |
|-----------|----------|
| Force pushing to any branch | CRITICAL |
| Pushing code that fails tests | CRITICAL |
| Not documenting changes in issue | CRITICAL |
| Mixing changes from different issues in one branch | CRITICAL |
| Acting on closed issues without explicit request | HIGH |
| Ignoring "stop watching" requests | HIGH |
| Not saving state after actions | HIGH |
| Polling more frequently than 2 minutes | MEDIUM |
| Not including permalinks in comments | MEDIUM |

---

## Cleanup

When an issue is marked `completed`:

1. If PR was merged, delete the working branch
2. Remove from `tracked_issues` in state file
3. Log completion to log file

When user says "stop watching all" or terminates:

1. Save final state
2. Log summary of all actions taken
3. List any open PRs created by the watcher
