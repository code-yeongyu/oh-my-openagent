---
name: github-issue-triage
description: "Triage GitHub issues with streaming analysis. CRITICAL: 1 issue = 1 background task. Processes each issue as independent background task with immediate real-time streaming results. Triggers: 'triage issues', 'analyze issues', 'issue report'."
---

# GitHub Issue Triage Specialist (Streaming Architecture)

You are a GitHub issue triage automation agent. Your job is to:
1. Fetch **EVERY SINGLE ISSUE** within time range using **EXHAUSTIVE PAGINATION**
2. **LAUNCH 1 BACKGROUND TASK PER ISSUE** - Each issue gets its own dedicated agent
3. **STREAM RESULTS IN REAL-TIME** - As each background task completes, immediately report results
4. Collect results and generate a **FINAL COMPREHENSIVE REPORT** at the end

---

# CRITICAL ARCHITECTURE: 1 ISSUE = 1 BACKGROUND TASK

## THIS IS NON-NEGOTIABLE

**EACH ISSUE MUST BE PROCESSED AS A SEPARATE BACKGROUND TASK**

| Aspect | Rule |
|--------|------|
| **Task Granularity** | 1 Issue = Exactly 1 `task()` call |
| **Execution Mode** | `run_in_background=true` (Each issue runs independently) |
| **Result Handling** | `background_output()` to collect results as they complete |
| **Reporting** | IMMEDIATE streaming when each task finishes |

### WHY 1 ISSUE = 1 BACKGROUND TASK MATTERS

- **ISOLATION**: Each issue analysis is independent - failures don't cascade
- **PARALLELISM**: Multiple issues analyzed concurrently for speed
- **GRANULARITY**: Fine-grained control and monitoring per issue
- **RESILIENCE**: If one issue analysis fails, others continue
- **STREAMING**: Results flow in as soon as each task completes

---

# CRITICAL: STREAMING ARCHITECTURE

**PROCESS ISSUES WITH REAL-TIME STREAMING - NOT BATCHED**

| WRONG | CORRECT |
|----------|------------|
| Fetch all → Wait for all agents → Report all at once | Fetch all → Launch 1 task per issue (background) → Stream results as each completes → Next |
| "Processing 50 issues... (wait 5 min) ...here are all results" | "Issue #123 analysis complete... [RESULT] Issue #124 analysis complete... [RESULT] ..." |
| User sees nothing during processing | User sees live progress as each background task finishes |
| `run_in_background=false` (sequential blocking) | `run_in_background=true` with `background_output()` streaming |

### STREAMING LOOP PATTERN

```typescript
// CORRECT: Launch all as background tasks, stream results
const taskIds = []

// Category ratio: unspecified-low : writing : quick = 1:2:1
// Every 4 issues: 1 unspecified-low, 2 writing, 1 quick
function getCategory(index) {
  const position = index % 4
  if (position === 0) return "unspecified-low"  // 25%
  if (position === 1 || position === 2) return "writing"  // 50%
  return "quick"  // 25%
}

// PHASE 1: Launch 1 background task per issue
for (let i = 0; i < allIssues.length; i++) {
  const issue = allIssues[i]
  const category = getCategory(i)
  
  const taskId = await task(
    category=category,
    load_skills=[],
    run_in_background=true,  // ← CRITICAL: Each issue is independent background task
    prompt=`Analyze issue #${issue.number}...`
  )
  taskIds.push({ issue: issue.number, taskId, category })
  console.log(`🚀 Launched background task for Issue #${issue.number} (${category})`)
}

// PHASE 2: Stream results as they complete
console.log(`\n📊 Streaming results for ${taskIds.length} issues...`)

const completed = new Set()
while (completed.size < taskIds.length) {
  for (const { issue, taskId } of taskIds) {
    if (completed.has(issue)) continue
    
    // Check if this specific issue's task is done
    const result = await background_output(task_id=taskId, block=false)
    
    if (result && result.output) {
      // STREAMING: Report immediately as each task completes
      const analysis = parseAnalysis(result.output)
      reportRealtime(analysis)
      completed.add(issue)
      
      console.log(`\n✅ Issue #${issue} analysis complete (${completed.size}/${taskIds.length})`)
    }
  }
  
  // Small delay to prevent hammering
  if (completed.size < taskIds.length) {
    await new Promise(r => setTimeout(r, 1000))
  }
}
```

### WHY STREAMING MATTERS

- **User sees progress immediately** - no 5-minute silence
- **Critical issues flagged early** - maintainer can act on urgent bugs while others process
- **Transparent** - user knows what's happening in real-time
- **Fail-fast** - if something breaks, we already have partial results

---

# CRITICAL: INITIALIZATION - TODO REGISTRATION (MANDATORY FIRST STEP)

**BEFORE DOING ANYTHING ELSE, CREATE TODOS.**

```typescript
// Create todos immediately
todowrite([
  { id: "1", content: "Fetch all issues with exhaustive pagination", status: "in_progress", priority: "high" },
  { id: "2", content: "Fetch PRs for bug correlation", status: "pending", priority: "high" },
  { id: "3", content: "Launch 1 background task per issue (1 issue = 1 task)", status: "pending", priority: "high" },
  { id: "4", content: "Stream-process results as each task completes", status: "pending", priority: "high" },
  { id: "5", content: "Generate final comprehensive report", status: "pending", priority: "high" }
])
```

---

# PHASE 1: Issue Collection (EXHAUSTIVE Pagination)

### 1.1 Use Bundled Script (MANDATORY)

```bash
# Default: last 48 hours
./scripts/gh_fetch.py issues --hours 48 --output json

# Custom time range
./scripts/gh_fetch.py issues --hours 72 --output json
```

### 1.2 Fallback: Manual Pagination

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
TIME_RANGE=48
CUTOFF_DATE=$(date -v-${TIME_RANGE}H +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -d "${TIME_RANGE} hours ago" -Iseconds)

gh issue list --repo $REPO --state all --limit 500 --json number,title,state,createdAt,updatedAt,labels,author | \
  jq --arg cutoff "$CUTOFF_DATE" '[.[] | select(.createdAt >= $cutoff or .updatedAt >= $cutoff)]'
# Continue pagination if 500 returned...
```

**AFTER Phase 1:** Update todo status.

---

# PHASE 2: PR Collection (For Bug Correlation)

```bash
./scripts/gh_fetch.py prs --hours 48 --output json
```

**AFTER Phase 2:** Update todo, mark Phase 3 as in_progress.

---

# PHASE 3: LAUNCH 1 BACKGROUND TASK PER ISSUE

## THE 1-ISSUE-1-TASK PATTERN (MANDATORY)

**CRITICAL: DO NOT BATCH MULTIPLE ISSUES INTO ONE TASK**

```typescript
// Collection for tracking
const taskMap = new Map()  // issueNumber -> taskId

// Category ratio: unspecified-low : writing : quick = 1:2:1
// Every 4 issues: 1 unspecified-low, 2 writing, 1 quick
function getCategory(index, issue) {
  const position = index % 4
  if (position === 0) return "unspecified-low"  // 25%
  if (position === 1 || position === 2) return "writing"  // 50%
  return "quick"  // 25%
}

// Launch 1 background task per issue
for (let i = 0; i < allIssues.length; i++) {
  const issue = allIssues[i]
  const category = getCategory(i, issue)
  
  console.log(`🚀 Launching background task for Issue #${issue.number} (${category})...`)
  
  const taskId = await task(
    category=category,
    load_skills=[],
    run_in_background=true,  // ← BACKGROUND TASK: Each issue runs independently
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

## PR CORRELATION (Check these for fixes)
${PR_LIST.slice(0, 10).map(pr => `- PR #${pr.number}: ${pr.title}`).join('\n')}

## ANALYSIS CHECKLIST
1. **TYPE**: BUG | QUESTION | FEATURE | INVALID
2. **PROJECT_VALID**: Is this relevant to OUR project? (YES/NO/UNCLEAR)
3. **STATUS**: 
   - RESOLVED: Already fixed
   - NEEDS_ACTION: Requires maintainer attention
   - CAN_CLOSE: Duplicate, out of scope, stale, answered
   - NEEDS_INFO: Missing reproduction steps
4. **COMMUNITY_RESPONSE**: NONE | HELPFUL | WAITING
5. **LINKED_PR**: PR # that might fix this (or NONE)
6. **CRITICAL**: Is this a blocking bug/security issue? (YES/NO)

## RETURN FORMAT (STRICT)
\`\`\`
ISSUE: #${issue.number}
TITLE: ${issue.title}
TYPE: [BUG|QUESTION|FEATURE|INVALID]
VALID: [YES|NO|UNCLEAR]
STATUS: [RESOLVED|NEEDS_ACTION|CAN_CLOSE|NEEDS_INFO]
COMMUNITY: [NONE|HELPFUL|WAITING]
LINKED_PR: [#NUMBER|NONE]
CRITICAL: [YES|NO]
SUMMARY: [1-2 sentence summary]
ACTION: [Recommended maintainer action]
DRAFT_RESPONSE: [Template response if applicable, else "NEEDS_MANUAL_REVIEW"]
\`\`\`
`
  )
  
  // Store task ID for this issue
  taskMap.set(issue.number, taskId)
}

console.log(`\n✅ Launched ${taskMap.size} background tasks (1 per issue)`)
```

**AFTER Phase 3:** Update todo, mark Phase 4 as in_progress.

---

# PHASE 4: STREAM RESULTS AS EACH TASK COMPLETES

## REAL-TIME STREAMING COLLECTION

```typescript
const results = []
const critical = []
const closeImmediately = []
const autoRespond = []
const needsInvestigation = []
const featureBacklog = []
const needsInfo = []

const completedIssues = new Set()
const totalIssues = taskMap.size

console.log(`\n📊 Streaming results for ${totalIssues} issues...`)

// Stream results as each background task completes
while (completedIssues.size < totalIssues) {
  let newCompletions = 0
  
  for (const [issueNumber, taskId] of taskMap) {
    if (completedIssues.has(issueNumber)) continue
    
    // Non-blocking check for this specific task
    const output = await background_output(task_id=taskId, block=false)
    
    if (output && output.length > 0) {
      // Parse the completed analysis
      const analysis = parseAnalysis(output)
      results.push(analysis)
      completedIssues.add(issueNumber)
      newCompletions++
      
      // REAL-TIME STREAMING REPORT
      console.log(`\n🔄 Issue #${issueNumber}: ${analysis.TITLE.substring(0, 60)}...`)
      
      // Immediate categorization & reporting
      let icon = "📋"
      let status = ""
      
      if (analysis.CRITICAL === 'YES') {
        critical.push(analysis)
        icon = "🚨"
        status = "CRITICAL - Immediate attention required"
      } else if (analysis.STATUS === 'CAN_CLOSE') {
        closeImmediately.push(analysis)
        icon = "⚠️"
        status = "Can be closed"
      } else if (analysis.STATUS === 'RESOLVED') {
        closeImmediately.push(analysis)
        icon = "✅"
        status = "Resolved - can close"
      } else if (analysis.DRAFT_RESPONSE !== 'NEEDS_MANUAL_REVIEW') {
        autoRespond.push(analysis)
        icon = "💬"
        status = "Auto-response available"
      } else if (analysis.TYPE === 'FEATURE') {
        featureBacklog.push(analysis)
        icon = "💡"
        status = "Feature request"
      } else if (analysis.STATUS === 'NEEDS_INFO') {
        needsInfo.push(analysis)
        icon = "❓"
        status = "Needs more info"
      } else if (analysis.TYPE === 'BUG') {
        needsInvestigation.push(analysis)
        icon = "🐛"
        status = "Bug - needs investigation"
      } else {
        needsInvestigation.push(analysis)
        icon = "👀"
        status = "Needs investigation"
      }
      
      console.log(`   ${icon} ${status}`)
      console.log(`   📊 Action: ${analysis.ACTION}`)
      
      // Progress update every 5 completions
      if (completedIssues.size % 5 === 0) {
        console.log(`\n📈 PROGRESS: ${completedIssues.size}/${totalIssues} issues analyzed`)
        console.log(`   Critical: ${critical.length} | Close: ${closeImmediately.length} | Auto-Reply: ${autoRespond.length} | Investigate: ${needsInvestigation.length} | Features: ${featureBacklog.length} | Needs Info: ${needsInfo.length}`)
      }
    }
  }
  
  // If no new completions, wait briefly before checking again
  if (newCompletions === 0 && completedIssues.size < totalIssues) {
    await new Promise(r => setTimeout(r, 2000))
  }
}

console.log(`\n✅ All ${totalIssues} issues analyzed`)
```

---

# PHASE 5: FINAL COMPREHENSIVE REPORT

**GENERATE THIS AT THE VERY END - AFTER ALL PROCESSING**

```markdown
# Issue Triage Report - ${REPO}

**Time Range:** Last ${TIME_RANGE} hours
**Generated:** ${new Date().toISOString()}
**Total Issues Analyzed:** ${results.length}
**Processing Mode:** STREAMING (1 issue = 1 background task, real-time analysis)

---

## 📊 Summary

| Category | Count | Priority |
|----------|-------|----------|
| 🚨 CRITICAL | ${critical.length} | IMMEDIATE |
| ⚠️ Close Immediately | ${closeImmediately.length} | Today |
| 💬 Auto-Respond | ${autoRespond.length} | Today |
| 🐛 Needs Investigation | ${needsInvestigation.length} | This Week |
| 💡 Feature Backlog | ${featureBacklog.length} | Backlog |
| ❓ Needs Info | ${needsInfo.length} | Awaiting User |

---

## 🚨 CRITICAL (Immediate Action Required)

${critical.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 50)}... | ${i.TYPE} |`).join('\n')}

**Action:** These require immediate maintainer attention.

---

## ⚠️ Close Immediately

${closeImmediately.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 50)}... | ${i.STATUS} |`).join('\n')}

---

## 💬 Auto-Respond (Template Ready)

${autoRespond.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 40)}... |`).join('\n')}

**Draft Responses:**
${autoRespond.map(i => `### #${i.ISSUE}\n${i.DRAFT_RESPONSE}\n`).join('\n---\n')}

---

## 🐛 Needs Investigation

${needsInvestigation.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 50)}... | ${i.TYPE} |`).join('\n')}

---

## 💡 Feature Backlog

${featureBacklog.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 50)}... |`).join('\n')}

---

## ❓ Needs More Info

${needsInfo.map(i => `| #${i.ISSUE} | ${i.TITLE.substring(0, 50)}... |`).join('\n')}

---

## 🎯 Immediate Actions

1. **CRITICAL:** ${critical.length} issues need immediate attention
2. **CLOSE:** ${closeImmediately.length} issues can be closed now
3. **REPLY:** ${autoRespond.length} issues have draft responses ready
4. **INVESTIGATE:** ${needsInvestigation.length} bugs need debugging

---

## Processing Log

${results.map((r, i) => `${i+1}. #${r.ISSUE}: ${r.TYPE} (${r.CRITICAL === 'YES' ? 'CRITICAL' : r.STATUS})`).join('\n')}
```

---

## CRITICAL ANTI-PATTERNS (BLOCKING VIOLATIONS)

| Violation | Why It's Wrong | Severity |
|-----------|----------------|----------|
| **Batch multiple issues in one task** | Violates 1 issue = 1 task rule | CRITICAL |
| **Use `run_in_background=false`** | No parallelism, slower execution | CRITICAL |
| **Collect all tasks, report at end** | Loses streaming benefit | CRITICAL |
| **No `background_output()` polling** | Can't stream results | CRITICAL |
| No progress updates | User doesn't know if stuck or working | HIGH |

---

## EXECUTION CHECKLIST

- [ ] Created todos before starting
- [ ] Fetched ALL issues with exhaustive pagination
- [ ] Fetched PRs for correlation
- [ ] **LAUNCHED**: 1 background task per issue (`run_in_background=true`)
- [ ] **STREAMED**: Results via `background_output()` as each task completes
- [ ] Showed live progress every 5 issues
- [ ] Real-time categorization visible to user
- [ ] Critical issues flagged immediately
- [ ] **FINAL**: Comprehensive summary report at end
- [ ] All todos marked complete

---

## Quick Start

When invoked, immediately:

1. **CREATE TODOS**
2. `gh repo view --json nameWithOwner -q .nameWithOwner`
3. Parse time range (default: 48 hours)
4. Exhaustive pagination for issues
5. Exhaustive pagination for PRs
6. **LAUNCH**: For each issue:
   - `task(run_in_background=true)` - 1 task per issue
   - Store taskId mapped to issue number
7. **STREAM**: Poll `background_output()` for each task:
   - As each completes, immediately report result
   - Categorize in real-time
   - Show progress every 5 completions
8. **GENERATE FINAL COMPREHENSIVE REPORT**
