/**
 * Watch GitHub Issues keyword detector.
 *
 * Triggers when the user wants to set up periodic GitHub issue monitoring
 * that can make changes, document them in issues, and respond to new comments.
 *
 * Trigger phrases:
 * - "watch github issues", "watch issues", "monitor issues"
 * - "github issue watcher", "issue monitor", "issue tracker"
 * - "watch gh issues", "track issues", "patrol issues"
 */

export const WATCH_GITHUB_ISSUES_PATTERN =
  /\b(watch\s*(github|gh)?\s*issues|monitor\s*(github|gh)?\s*issues|github\s*issue\s*watcher|issue\s*monitor|issue\s*tracker|track\s*(github|gh)?\s*issues|patrol\s*issues)\b/i

export const WATCH_GITHUB_ISSUES_MESSAGE = `[watch-github-issues-mode]
GITHUB ISSUE WATCHER MODE. Set up a persistent loop that monitors GitHub issues, implements fixes, and documents all changes back in the issues.

## ARCHITECTURE

This mode creates a **long-running agent loop** that:
1. Periodically polls GitHub issues for new/updated items
2. Analyzes each issue to determine if action is needed
3. Implements changes in the codebase when appropriate
4. Documents all changes back in the GitHub issue with permalinks
5. Re-checks issues for new comments/updates and addresses them

## PHASE 0: Setup

\`\`\`bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
BRANCH_PREFIX="issue-watcher"
POLL_INTERVAL=120  # seconds between polls
STATE_FILE="/tmp/issue-watcher-\${REPO//\\//-}-state.json"
LOG_FILE="/tmp/issue-watcher-\${REPO//\\//-}.log"
\`\`\`

Initialize state tracking:
\`\`\`json
{
  "last_poll": "ISO-8601",
  "tracked_issues": {
    "42": {
      "last_seen_comment_id": "IC_xxx",
      "last_updated_at": "ISO-8601",
      "status": "monitoring|in_progress|completed",
      "branch": "issue-watcher/42-fix-bug"
    }
  }
}
\`\`\`

## PHASE 1: Poll Loop

### 1.1 Fetch Issues

\`\`\`bash
# Get all open issues, sorted by recently updated
gh issue list --repo $REPO --state open --limit 100 \\
  --json number,title,body,comments,labels,author,updatedAt,createdAt
\`\`\`

### 1.2 Detect Changes Since Last Poll

For each issue, compare against saved state:
- **New issue**: Not in state file -> classify and potentially act
- **Updated issue**: \`updatedAt\` changed -> check for new comments
- **New comment on tracked issue**: Comment ID not seen before -> analyze and respond

### 1.3 Classification

| Label/Pattern | Action |
|--------------|--------|
| \`bug\`, "error", "broken", "crash" | Investigate codebase, attempt fix |
| \`enhancement\`, \`feature\`, "add", "implement" | Assess feasibility, implement if scoped |
| \`documentation\`, "docs", "typo" | Fix directly, document in issue |
| \`question\`, "how to", "?" | Research codebase, answer in issue |
| \`good first issue\`, \`help wanted\` | Prioritize for implementation |

## PHASE 2: Issue Processing

For each actionable issue:

### 2.1 Create Working Branch
\`\`\`bash
ISSUE_NUM={number}
BRANCH_NAME="issue-watcher/\${ISSUE_NUM}-\$(echo '{title}' | tr ' ' '-' | tr '[:upper:]' '[:lower:]' | head -c 40)"
git checkout -b "$BRANCH_NAME" main
\`\`\`

### 2.2 Investigate & Implement

1. **Read the issue thoroughly** - body + all comments
2. **Search the codebase** - find relevant files using Grep, Glob, AST-grep
3. **Implement the fix/feature** - make minimal, focused changes
4. **Run tests** - ensure nothing breaks
5. **Run lsp_diagnostics** - verify no type errors introduced

### 2.3 Document Changes in the Issue

After implementing, post a comment to the GitHub issue:

\`\`\`bash
gh issue comment $ISSUE_NUM --repo $REPO --body "$(cat <<'COMMENT_EOF'
## Automated Analysis & Changes

**Branch:** \`{branch_name}\`
**Commit:** \`{commit_sha}\`

### What was done
- [Description of each change with permalink]
- Example: Fixed null check in [\`src/auth.ts#L42\`](https://github.com/{REPO}/blob/{SHA}/src/auth.ts#L42)

### Files Changed
| File | Change |
|------|--------|
| \`path/to/file.ts\` | [Brief description] |

### Test Results
- [PASS/FAIL] - [test suite name]

### Next Steps
- [What remains, if anything]
- [Whether a PR should be created]

---
*This analysis was performed by the issue watcher agent. Reply to this issue to request additional changes.*
COMMENT_EOF
)"
\`\`\`

### 2.4 Create PR (if changes are substantial)

\`\`\`bash
gh pr create --repo $REPO \\
  --title "fix: address #\${ISSUE_NUM} - {title}" \\
  --body "Closes #\${ISSUE_NUM}\\n\\n{summary of changes}" \\
  --head "$BRANCH_NAME" \\
  --base main
\`\`\`

## PHASE 3: Comment Monitoring

### 3.1 Detect New Comments

On each poll cycle, for tracked issues:
\`\`\`bash
gh issue view $ISSUE_NUM --repo $REPO --json comments \\
  --jq '.comments | sort_by(.createdAt) | last'
\`\`\`

Compare comment ID with \`last_seen_comment_id\` in state.

### 3.2 Process New Comments

When a new comment is found from the issue author or maintainers:

1. **Parse the comment** for actionable requests:
   - "Can you also..." -> Additional implementation needed
   - "This doesn't fix..." -> Re-investigate, try different approach
   - "Please update..." -> Make specific requested changes
   - "LGTM" / "looks good" -> Mark as completed
   - "@bot stop" / "stop watching" -> Remove from tracked issues

2. **Act on the request**:
   - Switch to the issue's branch
   - Make additional changes
   - Push and comment back with update

3. **Update state**:
   - Save new \`last_seen_comment_id\`
   - Update \`status\` if needed

## PHASE 4: Continuous Loop

\`\`\`
while true:
  poll_issues()
  for each new/updated issue:
    classify(issue)
    if actionable:
      create_branch()
      investigate_and_implement()
      document_in_issue()
      create_pr_if_needed()
  for each tracked issue:
    check_new_comments()
    if new_comment:
      process_comment()
      act_on_request()
      update_issue()
  save_state()
  sleep(POLL_INTERVAL)
\`\`\`

## RULES (NON-NEGOTIABLE)

1. **Always document** - Every change MUST be documented in the GitHub issue with permalinks
2. **Minimal changes** - Fix only what the issue asks for, no drive-by refactoring
3. **Branch per issue** - Never mix changes from different issues
4. **Test before push** - Run tests and diagnostics before pushing any changes
5. **Respect stop signals** - If issue author says "stop", remove from tracking immediately
6. **No force push** - Never force push to any branch
7. **State persistence** - Always save state after each action (crash recovery)
8. **Rate limiting** - Minimum 2 minutes between polls, back off on API errors
9. **Only open issues** - Never act on closed issues unless explicitly asked
10. **Comment threading** - Always reference the specific comment being addressed

## STATE MANAGEMENT

Save state to \`/tmp/issue-watcher-*.json\` after every action:
- Tracks which issues are being monitored
- Tracks last seen comment per issue
- Tracks branches created per issue
- Enables resume after crash/restart

## ERROR HANDLING

- API rate limit hit -> Back off exponentially (2min, 4min, 8min, max 30min)
- Git conflict -> Document in issue, ask for human help
- Test failure -> Document in issue with failure details, do NOT push
- Unknown error -> Log to file, skip issue, continue loop`
