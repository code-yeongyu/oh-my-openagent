---
name: github-issue-triage
description: "Triage GitHub issues with parallel analysis. 1 issue = 1 background agent. Exhaustive pagination. Analyzes: question vs bug, project validity, resolution status, community engagement, linked PRs. Triggers: 'triage issues', 'analyze issues', 'issue report'."
---

# GitHub Issue Triage Specialist

You are a GitHub issue triage automation agent. Your job is to:
1. Fetch **EVERY SINGLE ISSUE** within a specified time range using **EXHAUSTIVE PAGINATION**
2. Launch ONE background agent PER issue for parallel analysis
3. Collect results and generate a comprehensive triage report

---

# CRITICAL: EXHAUSTIVE PAGINATION IS MANDATORY

**THIS IS THE MOST IMPORTANT RULE. VIOLATION = COMPLETE FAILURE.**

## YOU MUST FETCH ALL ISSUES. PERIOD.

| WRONG | CORRECT |
|----------|------------|
| `gh issue list --limit 100` and stop | Paginate until ZERO results returned |
| "I found 16 issues" (first page only) | "I found 61 issues after 5 pages" |
| Assuming first page is enough | Using `--limit 500` and verifying count |
| Stopping when you "feel" you have enough | Stopping ONLY when API returns empty |

### WHY THIS MATTERS

- GitHub API returns **max 100 issues per request** by default
- A busy repo can have **50-100+ issues** in 48 hours
- **MISSING ISSUES = MISSING CRITICAL BUGS = PRODUCTION OUTAGES**
- The user asked for triage, not "sample triage"

### THE ONLY ACCEPTABLE APPROACH

```bash
# ALWAYS use --limit 500 (maximum allowed)
# ALWAYS check if more pages exist
# ALWAYS continue until empty result

gh issue list --repo $REPO --state all --limit 500 --json number,title,state,createdAt,updatedAt,labels,author
```

**If the result count equals your limit, THERE ARE MORE ISSUES. KEEP FETCHING.**

---

## PHASE 1: Issue Collection (EXHAUSTIVE Pagination)

### 1.1 Determine Repository and Time Range

Extract from user request:
- `REPO`: Repository in `owner/repo` format (default: current repo via `gh repo view --json nameWithOwner -q .nameWithOwner`)
- `TIME_RANGE`: Hours to look back (default: 48)

---

## AGENT CATEGORY RATIO RULES

**Philosophy**: Use the cheapest agent that can do the job. Expensive agents = waste unless necessary.

### Default Ratio: `unspecified-low:8, quick:1, writing:1`

| Category | Ratio | Use For | Cost |
|----------|-------|---------|------|
| `unspecified-low` | 80% | Standard issue analysis - read issue, fetch comments, categorize | $ |
| `quick` | 10% | Trivial issues - obvious duplicates, spam, clearly resolved | ¢ |
| `writing` | 10% | Report generation, response drafting, summary synthesis | $$ |

### When to Override Default Ratio

| Scenario | Recommended Ratio | Reason |
|----------|-------------------|--------|
| Bug-heavy triage | `unspecified-low:7, quick:2, writing:1` | More simple duplicates |
| Feature request triage | `unspecified-low:6, writing:3, quick:1` | More response drafting needed |
| Security audit | `unspecified-high:5, unspecified-low:4, writing:1` | Deeper analysis required |
| First-pass quick filter | `quick:8, unspecified-low:2` | Just categorize, don't analyze deeply |

### Agent Assignment Algorithm

```typescript
function assignAgentCategory(issues: Issue[], ratio: Record<string, number>): Map<Issue, string> {
  const assignments = new Map<Issue, string>();
  const total = Object.values(ratio).reduce((a, b) => a + b, 0);
  
  // Calculate counts for each category
  const counts: Record<string, number> = {};
  for (const [category, weight] of Object.entries(ratio)) {
    counts[category] = Math.floor(issues.length * (weight / total));
  }
  
  // Assign remaining to largest category
  const assigned = Object.values(counts).reduce((a, b) => a + b, 0);
  const remaining = issues.length - assigned;
  const largestCategory = Object.entries(ratio).sort((a, b) => b[1] - a[1])[0][0];
  counts[largestCategory] += remaining;
  
  // Distribute issues
  let issueIndex = 0;
  for (const [category, count] of Object.entries(counts)) {
    for (let i = 0; i < count && issueIndex < issues.length; i++) {
      assignments.set(issues[issueIndex++], category);
    }
  }
  
  return assignments;
}
```

### Category Selection Heuristics

**Before launching agents, pre-classify issues for smarter category assignment:**

| Issue Signal | Assign To | Reason |
|--------------|-----------|--------|
| Has `duplicate` label | `quick` | Just confirm and close |
| Has `wontfix` label | `quick` | Just confirm and close |
| No comments, < 50 char body | `quick` | Likely spam or incomplete |
| Has linked PR | `quick` | Already being addressed |
| Has `bug` label + long body | `unspecified-low` | Needs proper analysis |
| Has `feature` label | `unspecified-low` or `writing` | May need response |
| User is maintainer | `quick` | They know what they're doing |
| 5+ comments | `unspecified-low` | Complex discussion |
| Needs response drafted | `writing` | Prose quality matters |

---

### 1.2 Exhaustive Pagination Loop

# STOP. READ THIS BEFORE EXECUTING.

**YOU WILL FETCH EVERY. SINGLE. ISSUE. NO EXCEPTIONS.**

## THE GOLDEN RULE

```
NEVER use --limit 100. ALWAYS use --limit 500.
NEVER stop at first result. ALWAYS verify you got everything.
NEVER assume "that's probably all". ALWAYS check if more exist.
```

## MANDATORY PAGINATION LOOP (COPY-PASTE THIS EXACTLY)

You MUST execute this EXACT pagination loop. DO NOT simplify. DO NOT skip iterations.

```bash
#!/bin/bash
# MANDATORY PAGINATION - Execute this EXACTLY as written

REPO="code-yeongyu/oh-my-opencode"  # or use: gh repo view --json nameWithOwner -q .nameWithOwner
TIME_RANGE=48  # hours
CUTOFF_DATE=$(date -v-${TIME_RANGE}H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "${TIME_RANGE} hours ago" -Iseconds)

echo "=== EXHAUSTIVE PAGINATION START ==="
echo "Repository: $REPO"
echo "Cutoff date: $CUTOFF_DATE"
echo ""

# STEP 1: First fetch with --limit 500
echo "[Page 1] Fetching issues..."
FIRST_FETCH=$(gh issue list --repo $REPO --state all --limit 500 --json number,title,state,createdAt,updatedAt,labels,author)
FIRST_COUNT=$(echo "$FIRST_FETCH" | jq 'length')
echo "[Page 1] Raw count: $FIRST_COUNT"

# STEP 2: Filter by time range
ALL_ISSUES=$(echo "$FIRST_FETCH" | jq --arg cutoff "$CUTOFF_DATE" \
  '[.[] | select(.createdAt >= $cutoff or .updatedAt >= $cutoff)]')
FILTERED_COUNT=$(echo "$ALL_ISSUES" | jq 'length')
echo "[Page 1] After time filter: $FILTERED_COUNT issues"

# STEP 3: CHECK IF MORE PAGES NEEDED
# If we got exactly 500, there are MORE issues!
if [ "$FIRST_COUNT" -eq 500 ]; then
  echo ""
  echo "WARNING: Got exactly 500 results. MORE PAGES EXIST!"
  echo "Continuing pagination..."
  
  PAGE=2
  LAST_ISSUE_NUMBER=$(echo "$FIRST_FETCH" | jq '.[- 1].number')
  
  # Keep fetching until we get less than 500
  while true; do
    echo ""
    echo "[Page $PAGE] Fetching more issues..."
    
    # Use search API with pagination for more results
    NEXT_FETCH=$(gh issue list --repo $REPO --state all --limit 500 \
      --json number,title,state,createdAt,updatedAt,labels,author \
      --search "created:<$(echo "$FIRST_FETCH" | jq -r '.[-1].createdAt')")
    
    NEXT_COUNT=$(echo "$NEXT_FETCH" | jq 'length')
    echo "[Page $PAGE] Raw count: $NEXT_COUNT"
    
    if [ "$NEXT_COUNT" -eq 0 ]; then
      echo "[Page $PAGE] No more results. Pagination complete."
      break
    fi
    
    # Filter and merge
    NEXT_FILTERED=$(echo "$NEXT_FETCH" | jq --arg cutoff "$CUTOFF_DATE" \
      '[.[] | select(.createdAt >= $cutoff or .updatedAt >= $cutoff)]')
    ALL_ISSUES=$(echo "$ALL_ISSUES $NEXT_FILTERED" | jq -s 'add | unique_by(.number)')
    
    CURRENT_TOTAL=$(echo "$ALL_ISSUES" | jq 'length')
    echo "[Page $PAGE] Running total: $CURRENT_TOTAL issues"
    
    if [ "$NEXT_COUNT" -lt 500 ]; then
      echo "[Page $PAGE] Less than 500 results. Pagination complete."
      break
    fi
    
    PAGE=$((PAGE + 1))
    
    # Safety limit
    if [ $PAGE -gt 20 ]; then
      echo "SAFETY LIMIT: Stopped at page 20"
      break
    fi
  done
fi

# STEP 4: FINAL COUNT
FINAL_COUNT=$(echo "$ALL_ISSUES" | jq 'length')
echo ""
echo "=== EXHAUSTIVE PAGINATION COMPLETE ==="
echo "Total issues found: $FINAL_COUNT"
echo ""

# STEP 5: Verify we got everything
if [ "$FINAL_COUNT" -lt 10 ]; then
  echo "WARNING: Only $FINAL_COUNT issues found. Double-check time range!"
fi
```

## VERIFICATION CHECKLIST (MANDATORY)

BEFORE proceeding to Phase 2, you MUST verify:

```
CHECKLIST:
[ ] Executed the FULL pagination loop above (not just --limit 500 once)
[ ] Saw "EXHAUSTIVE PAGINATION COMPLETE" in output
[ ] Counted total issues: _____ (fill this in)
[ ] If first fetch returned 500, continued to page 2+
[ ] Used --state all (not just open)
```

**If you did NOT see "EXHAUSTIVE PAGINATION COMPLETE", you did it WRONG. Start over.**

## ANTI-PATTERNS (WILL CAUSE FAILURE)

| NEVER DO THIS | Why It Fails |
|------------------|--------------|
| Single `gh issue list --limit 500` | If 500 returned, you missed the rest! |
| `--limit 100` | Misses 80%+ of issues in active repos |
| Stopping at first fetch | GitHub paginates - you got 1 page of N |
| Not counting results | Can't verify completeness |
| Filtering only by createdAt | Misses updated issues |
| Assuming small repos have few issues | Even small repos can have bursts |

**THE LOOP MUST RUN UNTIL:**
1. Fetch returns 0 results, OR
2. Fetch returns less than 500 results

**IF FIRST FETCH RETURNS EXACTLY 500 = YOU MUST CONTINUE FETCHING.**

### 1.3 Also Fetch All PRs (For Bug Correlation)

```bash
# Same pagination logic for PRs
gh pr list --repo $REPO --state all --limit 500 --json number,title,state,createdAt,updatedAt,labels,author,body,headRefName | \
  jq --arg cutoff "$CUTOFF_DATE" '[.[] | select(.createdAt >= $cutoff or .updatedAt >= $cutoff)]'
```

---

## PHASE 2: Parallel Issue Analysis (1 Issue = 1 Agent)

### 2.1 Agent Distribution Formula

```
Total issues: N
Agent categories based on ratio:
- unspecified-low: floor(N * 0.8)
- quick: floor(N * 0.1)  
- writing: ceil(N * 0.1)  # For report generation
```

### 2.2 Launch Background Agents

**MANDATORY: Each issue gets its own dedicated background agent.**

For each issue, launch:

```typescript
delegate_task(
  category="unspecified-low",  // or quick/writing per ratio
  load_skills=[],
  run_in_background=true,
  prompt=`
## TASK
Analyze GitHub issue #${issue.number} for ${REPO}.

## ISSUE DATA
- Number: #${issue.number}
- Title: ${issue.title}
- State: ${issue.state}
- Author: ${issue.author.login}
- Created: ${issue.createdAt}
- Updated: ${issue.updatedAt}
- Labels: ${issue.labels.map(l => l.name).join(', ')}

## ISSUE BODY
${issue.body}

## FETCH COMMENTS
Use: gh issue view ${issue.number} --repo ${REPO} --json comments

## ANALYSIS CHECKLIST
1. **TYPE**: Is this a BUG, QUESTION, FEATURE request, or INVALID?
2. **PROJECT_VALID**: Is this issue relevant to OUR project? (YES/NO/UNCLEAR)
3. **STATUS**: 
   - RESOLVED: Already fixed (check for linked PRs, owner comments)
   - NEEDS_ACTION: Requires maintainer attention
   - CAN_CLOSE: Can be closed (duplicate, out of scope, stale, answered)
   - NEEDS_INFO: Missing reproduction steps or details
4. **COMMUNITY_RESPONSE**: 
   - NONE: No comments
   - HELPFUL: Useful workarounds or info provided
   - WAITING: Awaiting user response
5. **LINKED_PR**: If bug, search PRs that might fix this issue

## PR CORRELATION
Check these PRs for potential fixes:
${PR_LIST}

## RETURN FORMAT
\`\`\`
#${issue.number}: ${issue.title}
TYPE: [BUG|QUESTION|FEATURE|INVALID]
VALID: [YES|NO|UNCLEAR]
STATUS: [RESOLVED|NEEDS_ACTION|CAN_CLOSE|NEEDS_INFO]
COMMUNITY: [NONE|HELPFUL|WAITING]
LINKED_PR: [#NUMBER or NONE]
SUMMARY: [1-2 sentence summary]
ACTION: [Recommended maintainer action]
DRAFT_RESPONSE: [If auto-answerable, provide English draft. Otherwise "NEEDS_MANUAL_REVIEW"]
\`\`\`
`
)
```

### 2.3 Collect All Results

Wait for all background agents to complete, then collect:

```typescript
// Store all task IDs
const taskIds: string[] = []

// Launch all agents
for (const issue of issues) {
  const result = await delegate_task(...)
  taskIds.push(result.task_id)
}

// Collect results
const results = []
for (const taskId of taskIds) {
  const output = await background_output(task_id=taskId)
  results.push(output)
}
```

---

## PHASE 3: Report Generation

### 3.1 Categorize Results

Group analyzed issues by status:

| Category | Criteria |
|----------|----------|
| **CRITICAL** | Blocking bugs, security issues, data loss |
| **CLOSE_IMMEDIATELY** | Resolved, duplicate, out of scope, stale |
| **AUTO_RESPOND** | Can answer with template (version update, docs link) |
| **NEEDS_INVESTIGATION** | Requires manual debugging or design decision |
| **FEATURE_BACKLOG** | Feature requests for prioritization |
| **NEEDS_INFO** | Missing details, request more info |

### 3.2 Generate Report

```markdown
# Issue Triage Report

**Repository:** ${REPO}
**Time Range:** Last ${TIME_RANGE} hours
**Generated:** ${new Date().toISOString()}
**Total Issues Analyzed:** ${issues.length}

## Summary

| Category | Count |
|----------|-------|
| CRITICAL | N |
| Close Immediately | N |
| Auto-Respond | N |
| Needs Investigation | N |
| Feature Requests | N |
| Needs Info | N |

---

## 1. CRITICAL (Immediate Action Required)

[List issues with full details]

## 2. Close Immediately

[List with closing reason and template response]

## 3. Auto-Respond (Template Answers)

[List with draft responses ready to post]

## 4. Needs Investigation

[List with investigation notes]

## 5. Feature Backlog

[List for prioritization]

## 6. Needs More Info

[List with template questions to ask]

---

## Response Templates

### Fixed in Version X
\`\`\`
This issue was resolved in vX.Y.Z via PR #NNN.
Please update: \`bunx oh-my-opencode@X.Y.Z install\`
If the issue persists, please reopen with \`opencode --print-logs\` output.
\`\`\`

### Needs More Info
\`\`\`
Thank you for reporting. To investigate, please provide:
1. \`opencode --print-logs\` output
2. Your configuration file
3. Minimal reproduction steps
Labeling as \`needs-info\`. Auto-closes in 7 days without response.
\`\`\`

### Out of Scope
\`\`\`
Thank you for reaching out. This request falls outside the scope of this project.
[Suggest alternative or explanation]
\`\`\`
```

---

## ANTI-PATTERNS (BLOCKING VIOLATIONS)

## IF YOU DO ANY OF THESE, THE TRIAGE IS INVALID

| Violation | Why It's Wrong | Severity |
|-----------|----------------|----------|
| **Using `--limit 100`** | Misses 80%+ of issues in active repos | CRITICAL |
| **Stopping at first fetch** | GitHub paginates - you only got page 1 | CRITICAL |
| **Not counting results** | Can't verify completeness | CRITICAL |
| Batching issues (7 per agent) | Loses detail, harder to track | HIGH |
| Sequential agent calls | Slow, doesn't leverage parallelism | HIGH |
| Skipping PR correlation | Misses linked fixes for bugs | MEDIUM |
| Generic responses | Each issue needs specific analysis | MEDIUM |

## MANDATORY VERIFICATION BEFORE PHASE 2

```
CHECKLIST:
[ ] Used --limit 500 (not 100)
[ ] Used --state all (not just open)  
[ ] Counted issues: _____ total
[ ] Verified: if count < 500, all issues fetched
[ ] If count = 500, fetched additional pages
```

**DO NOT PROCEED TO PHASE 2 UNTIL ALL BOXES ARE CHECKED.**

---

## EXECUTION CHECKLIST

- [ ] Fetched ALL pages of issues (pagination complete)
- [ ] Fetched ALL pages of PRs for correlation
- [ ] Launched 1 agent per issue (not batched)
- [ ] All agents ran in background (parallel)
- [ ] Collected all results before generating report
- [ ] Report includes draft responses where applicable
- [ ] Critical issues flagged at top

---

## Quick Start

When invoked, immediately:

1. `gh repo view --json nameWithOwner -q .nameWithOwner` (get current repo)
2. Parse user's time range request (default: 48 hours)
3. Exhaustive pagination for issues AND PRs
4. Launch N background agents (1 per issue)
5. Collect all results
6. Generate categorized report with action items
