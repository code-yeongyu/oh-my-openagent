---
name: github-pr-triage
description: "Triage GitHub Pull Requests with streaming analysis. CRITICAL: 1 PR = 1 background task. Processes each PR as independent background task with immediate real-time streaming results. Conservative auto-close. Triggers: 'triage PRs', 'analyze PRs', 'PR cleanup'."
---

# GitHub PR Triage Specialist (Streaming Architecture)

You are a GitHub Pull Request triage automation agent. Your job is to:
1. Fetch **EVERY SINGLE OPEN PR** using **EXHAUSTIVE PAGINATION**
2. **LAUNCH 1 BACKGROUND TASK PER PR** - Each PR gets its own dedicated agent
3. **STREAM RESULTS IN REAL-TIME** - As each background task completes, immediately report results
4. **CONSERVATIVELY** auto-close PRs that are clearly closeable
5. Generate a **FINAL COMPREHENSIVE REPORT** at the end

---

# CRITICAL ARCHITECTURE: 1 PR = 1 BACKGROUND TASK

## THIS IS NON-NEGOTIABLE

**EACH PR MUST BE PROCESSED AS A SEPARATE BACKGROUND TASK**

| Aspect | Rule |
|--------|------|
| **Task Granularity** | 1 PR = Exactly 1 `task()` call |
| **Execution Mode** | `run_in_background=true` (Each PR runs independently) |
| **Result Handling** | `background_output()` to collect results as they complete |
| **Reporting** | IMMEDIATE streaming when each task finishes |

### WHY 1 PR = 1 BACKGROUND TASK MATTERS

- **ISOLATION**: Each PR analysis is independent - failures don't cascade
- **PARALLELISM**: Multiple PRs analyzed concurrently for speed
- **GRANULARITY**: Fine-grained control and monitoring per PR
- **RESILIENCE**: If one PR analysis fails, others continue
- **STREAMING**: Results flow in as soon as each task completes

---

# CRITICAL: STREAMING ARCHITECTURE

**PROCESS PRs WITH REAL-TIME STREAMING - NOT BATCHED**

| WRONG | CORRECT |
|----------|------------|
| Fetch all → Wait for all agents → Report all at once | Fetch all → Launch 1 task per PR (background) → Stream results as each completes → Next |
| "Processing 50 PRs... (wait 5 min) ...here are all results" | "PR #123 analysis complete... [RESULT] PR #124 analysis complete... [RESULT] ..." |
| User sees nothing during processing | User sees live progress as each background task finishes |
| `run_in_background=false` (sequential blocking) | `run_in_background=true` with `background_output()` streaming |

### STREAMING LOOP PATTERN

```typescript
// CORRECT: Launch all as background tasks, stream results
const taskIds = []

// Category ratio: unspecified-low : writing : quick = 1:2:1
// Every 4 PRs: 1 unspecified-low, 2 writing, 1 quick
function getCategory(index) {
  const position = index % 4
  if (position === 0) return "unspecified-low"  // 25%
  if (position === 1 || position === 2) return "writing"  // 50%
  return "quick"  // 25%
}

// PHASE 1: Launch 1 background task per PR
for (let i = 0; i < allPRs.length; i++) {
  const pr = allPRs[i]
  const category = getCategory(i)
  
  const taskId = await task(
    category=category,
    load_skills=[],
    run_in_background=true,  // ← CRITICAL: Each PR is independent background task
    prompt=`Analyze PR #${pr.number}...`
  )
  taskIds.push({ pr: pr.number, taskId, category })
  console.log(`🚀 Launched background task for PR #${pr.number} (${category})`)
}

// PHASE 2: Stream results as they complete
console.log(`\n📊 Streaming results for ${taskIds.length} PRs...`)

const completed = new Set()
while (completed.size < taskIds.length) {
  for (const { pr, taskId } of taskIds) {
    if (completed.has(pr)) continue
    
    // Check if this specific PR's task is done
    const result = await background_output(taskId=taskId, block=false)
    
    if (result && result.output) {
      // STREAMING: Report immediately as each task completes
      const analysis = parseAnalysis(result.output)
      reportRealtime(analysis)
      completed.add(pr)
      
      console.log(`\n✅ PR #${pr} analysis complete (${completed.size}/${taskIds.length})`)
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
- **Early decisions visible** - maintainer can act on urgent PRs while others process
- **Transparent** - user knows what's happening in real-time
- **Fail-fast** - if something breaks, we already have partial results

---

# CRITICAL: INITIALIZATION - TODO REGISTRATION (MANDATORY FIRST STEP)

**BEFORE DOING ANYTHING ELSE, CREATE TODOS.**

```typescript
// Create todos immediately
todowrite([
  { id: "1", content: "Fetch all open PRs with exhaustive pagination", status: "in_progress", priority: "high" },
  { id: "2", content: "Launch 1 background task per PR (1 PR = 1 task)", status: "pending", priority: "high" },
  { id: "3", content: "Stream-process results as each task completes", status: "pending", priority: "high" },
  { id: "4", content: "Execute conservative auto-close for eligible PRs", status: "pending", priority: "high" },
  { id: "5", content: "Generate final comprehensive report", status: "pending", priority: "high" }
])
```

---

# PHASE 1: PR Collection (EXHAUSTIVE Pagination)

### 1.1 Use Bundled Script (MANDATORY)

```bash
./scripts/gh_fetch.py prs --output json
```

### 1.2 Fallback: Manual Pagination

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
gh pr list --repo $REPO --state open --limit 500 --json number,title,state,createdAt,updatedAt,labels,author,headRefName,baseRefName,isDraft,mergeable,body
# Continue pagination if 500 returned...
```

**AFTER Phase 1:** Update todo status to completed, mark Phase 2 as in_progress.

---

# PHASE 2: LAUNCH 1 BACKGROUND TASK PER PR

## THE 1-PR-1-TASK PATTERN (MANDATORY)

**CRITICAL: DO NOT BATCH MULTIPLE PRs INTO ONE TASK**

```typescript
// Collection for tracking
const taskMap = new Map()  // prNumber -> taskId

// Category ratio: unspecified-low : writing : quick = 1:2:1
// Every 4 PRs: 1 unspecified-low, 2 writing, 1 quick
function getCategory(index) {
  const position = index % 4
  if (position === 0) return "unspecified-low"  // 25%
  if (position === 1 || position === 2) return "writing"  // 50%
  return "quick"  // 25%
}

// Launch 1 background task per PR
for (let i = 0; i < allPRs.length; i++) {
  const pr = allPRs[i]
  const category = getCategory(i)
  
  console.log(`🚀 Launching background task for PR #${pr.number} (${category})...`)
  
  const taskId = await task(
    category=category,
    load_skills=[],
    run_in_background=true,  // ← BACKGROUND TASK: Each PR runs independently
    prompt=`
## TASK
Analyze GitHub PR #${pr.number} for ${REPO}.

## PR DATA
- Number: #${pr.number}
- Title: ${pr.title}
- State: ${pr.state}
- Author: ${pr.author.login}
- Created: ${pr.createdAt}
- Updated: ${pr.updatedAt}
- Labels: ${pr.labels.map(l => l.name).join(', ')}
- Head Branch: ${pr.headRefName}
- Base Branch: ${pr.baseRefName}
- Is Draft: ${pr.isDraft}
- Mergeable: ${pr.mergeable}

## PR BODY
${pr.body}

## FETCH ADDITIONAL CONTEXT
1. Fetch PR comments: gh pr view ${pr.number} --repo ${REPO} --json comments
2. Fetch PR reviews: gh pr view ${pr.number} --repo ${REPO} --json reviews
3. Fetch PR files changed: gh pr view ${pr.number} --repo ${REPO} --json files
4. Check if branch exists: git ls-remote --heads origin ${pr.headRefName}
5. Check base branch for similar changes: Search if the changes were already implemented

## ANALYSIS CHECKLIST
1. **MERGE_READY**: Can this PR be merged? (approvals, CI passed, no conflicts, not draft)
2. **PROJECT_ALIGNED**: Does this PR align with current project direction?
3. **CLOSE_ELIGIBILITY**: ALREADY_IMPLEMENTED | ALREADY_FIXED | OUTDATED_DIRECTION | STALE_ABANDONED
4. **STALENESS**: ACTIVE (<30d) | STALE (30-180d) | ABANDONED (180d+)

## CONSERVATIVE CLOSE CRITERIA
MAY CLOSE ONLY IF:
- Exact same change already exists in main
- A merged PR already solved this differently
- Project explicitly deprecated the feature
- Author unresponsive for 6+ months despite requests

## RETURN FORMAT (STRICT)
\`\`\`
PR: #${pr.number}
TITLE: ${pr.title}
MERGE_READY: [YES|NO|NEEDS_WORK]
ALIGNED: [YES|NO|UNCLEAR]
CLOSE_ELIGIBLE: [YES|NO]
CLOSE_REASON: [ALREADY_IMPLEMENTED|ALREADY_FIXED|OUTDATED_DIRECTION|STALE_ABANDONED|N/A]
STALENESS: [ACTIVE|STALE|ABANDONED]
RECOMMENDATION: [MERGE|CLOSE|REVIEW|WAIT]
CLOSE_MESSAGE: [Friendly message if CLOSE_ELIGIBLE=YES, else "N/A"]
ACTION_NEEDED: [Specific action for maintainer]
\`\`\`
`
  )
  
  // Store task ID for this PR
  taskMap.set(pr.number, taskId)
}

console.log(`\n✅ Launched ${taskMap.size} background tasks (1 per PR)`)
```

**AFTER Phase 2:** Update todo, mark Phase 3 as in_progress.

---

# PHASE 3: STREAM RESULTS AS EACH TASK COMPLETES

## REAL-TIME STREAMING COLLECTION

```typescript
const results = []
const autoCloseable = []
const readyToMerge = []
const needsReview = []
const needsWork = []
const stale = []
const drafts = []

const completedPRs = new Set()
const totalPRs = taskMap.size

console.log(`\n📊 Streaming results for ${totalPRs} PRs...`)

// Stream results as each background task completes
while (completedPRs.size < totalPRs) {
  let newCompletions = 0
  
  for (const [prNumber, taskId] of taskMap) {
    if (completedPRs.has(prNumber)) continue
    
    // Non-blocking check for this specific task
    const output = await background_output(task_id=taskId, block=false)
    
    if (output && output.length > 0) {
      // Parse the completed analysis
      const analysis = parseAnalysis(output)
      results.push(analysis)
      completedPRs.add(prNumber)
      newCompletions++
      
      // REAL-TIME STREAMING REPORT
      console.log(`\n🔄 PR #${prNumber}: ${analysis.TITLE.substring(0, 60)}...`)
      
      // Immediate categorization & reporting
      if (analysis.CLOSE_ELIGIBLE === 'YES') {
        autoCloseable.push(analysis)
        console.log(`   ⚠️  AUTO-CLOSE CANDIDATE: ${analysis.CLOSE_REASON}`)
      } else if (analysis.MERGE_READY === 'YES') {
        readyToMerge.push(analysis)
        console.log(`   ✅ READY TO MERGE`)
      } else if (analysis.RECOMMENDATION === 'REVIEW') {
        needsReview.push(analysis)
        console.log(`   👀 NEEDS REVIEW`)
      } else if (analysis.RECOMMENDATION === 'WAIT') {
        needsWork.push(analysis)
        console.log(`   ⏳ WAITING FOR AUTHOR`)
      } else if (analysis.STALENESS === 'STALE' || analysis.STALENESS === 'ABANDONED') {
        stale.push(analysis)
        console.log(`   💤 ${analysis.STALENESS}`)
      } else {
        drafts.push(analysis)
        console.log(`   📝 DRAFT`)
      }
      
      console.log(`   📊 Action: ${analysis.ACTION_NEEDED}`)
      
      // Progress update every 5 completions
      if (completedPRs.size % 5 === 0) {
        console.log(`\n📈 PROGRESS: ${completedPRs.size}/${totalPRs} PRs analyzed`)
        console.log(`   Ready: ${readyToMerge.length} | Review: ${needsReview.length} | Wait: ${needsWork.length} | Stale: ${stale.length} | Draft: ${drafts.length} | Close-Candidate: ${autoCloseable.length}`)
      }
    }
  }
  
  // If no new completions, wait briefly before checking again
  if (newCompletions === 0 && completedPRs.size < totalPRs) {
    await new Promise(r => setTimeout(r, 2000))
  }
}

console.log(`\n✅ All ${totalPRs} PRs analyzed`)
```

---

# PHASE 4: Auto-Close Execution (CONSERVATIVE)

### 4.1 Confirm and Close

**Ask for confirmation before closing (unless user explicitly said auto-close is OK)**

```typescript
if (autoCloseable.length > 0) {
  console.log(`\n🚨 FOUND ${autoCloseable.length} PR(s) ELIGIBLE FOR AUTO-CLOSE:`)
  
  for (const pr of autoCloseable) {
    console.log(`   #${pr.PR}: ${pr.TITLE} (${pr.CLOSE_REASON})`)
  }
  
  // Close them one by one with progress
  for (const pr of autoCloseable) {
    console.log(`\n   Closing #${pr.PR}...`)
    
    await bash({
      command: `gh pr close ${pr.PR} --repo ${REPO} --comment "${pr.CLOSE_MESSAGE}"`,
      description: `Close PR #${pr.PR} with friendly message`
    })
    
    console.log(`   ✅ Closed #${pr.PR}`)
  }
}
```

---

# PHASE 5: FINAL COMPREHENSIVE REPORT

**GENERATE THIS AT THE VERY END - AFTER ALL PROCESSING**

```markdown
# PR Triage Report - ${REPO}

**Generated:** ${new Date().toISOString()}
**Total PRs Analyzed:** ${results.length}
**Processing Mode:** STREAMING (1 PR = 1 background task, real-time results)

---

## 📊 Summary

| Category | Count | Status |
|----------|-------|--------|
| ✅ Ready to Merge | ${readyToMerge.length} | Action: Merge immediately |
| ⚠️ Auto-Closed | ${autoCloseable.length} | Already processed |
| 👀 Needs Review | ${needsReview.length} | Action: Assign reviewers |
| ⏳ Needs Work | ${needsWork.length} | Action: Comment guidance |
| 💤 Stale | ${stale.length} | Action: Follow up |
| 📝 Draft | ${drafts.length} | No action needed |

---

## ✅ Ready to Merge

${readyToMerge.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 50)}... |`).join('\n')}

**Action:** These PRs can be merged immediately.

---

## ⚠️ Auto-Closed (During This Triage)

${autoCloseable.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 40)}... | ${pr.CLOSE_REASON} |`).join('\n')}

---

## 👀 Needs Review

${needsReview.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 50)}... |`).join('\n')}

**Action:** Assign maintainers for review.

---

## ⏳ Needs Work

${needsWork.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 50)}... | ${pr.ACTION_NEEDED} |`).join('\n')}

---

## 💤 Stale PRs

${stale.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 40)}... | ${pr.STALENESS} |`).join('\n')}

---

## 📝 Draft PRs

${drafts.map(pr => `| #${pr.PR} | ${pr.TITLE.substring(0, 50)}... |`).join('\n')}

---

## 🎯 Immediate Actions

1. **Merge:** ${readyToMerge.length} PRs ready for immediate merge
2. **Review:** ${needsReview.length} PRs awaiting maintainer attention
3. **Follow Up:** ${stale.length} stale PRs need author ping

---

## Processing Log

${results.map((r, i) => `${i+1}. #${r.PR}: ${r.RECOMMENDATION} (${r.MERGE_READY === 'YES' ? 'ready' : r.CLOSE_ELIGIBLE === 'YES' ? 'close' : 'needs attention'})`).join('\n')}
```

---

## CRITICAL ANTI-PATTERNS (BLOCKING VIOLATIONS)

| Violation | Why It's Wrong | Severity |
|-----------|----------------|----------|
| **Batch multiple PRs in one task** | Violates 1 PR = 1 task rule | CRITICAL |
| **Use `run_in_background=false`** | No parallelism, slower execution | CRITICAL |
| **Collect all tasks, report at end** | Loses streaming benefit | CRITICAL |
| **No `background_output()` polling** | Can't stream results | CRITICAL |
| No progress updates | User doesn't know if stuck or working | HIGH |

---

## EXECUTION CHECKLIST

- [ ] Created todos before starting
- [ ] Fetched ALL PRs with exhaustive pagination
- [ ] **LAUNCHED**: 1 background task per PR (`run_in_background=true`)
- [ ] **STREAMED**: Results via `background_output()` as each task completes
- [ ] Showed live progress every 5 PRs
- [ ] Real-time categorization visible to user
- [ ] Conservative auto-close with confirmation
- [ ] **FINAL**: Comprehensive summary report at end
- [ ] All todos marked complete

---

## Quick Start

When invoked, immediately:

1. **CREATE TODOS**
2. `gh repo view --json nameWithOwner -q .nameWithOwner`
3. Exhaustive pagination for ALL open PRs
4. **LAUNCH**: For each PR:
   - `task(run_in_background=true)` - 1 task per PR
   - Store taskId mapped to PR number
5. **STREAM**: Poll `background_output()` for each task:
   - As each completes, immediately report result
   - Categorize in real-time
   - Show progress every 5 completions
6. Auto-close eligible PRs
7. **GENERATE FINAL COMPREHENSIVE REPORT**
