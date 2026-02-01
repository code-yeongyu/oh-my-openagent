import type { PluginInput } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  readBoulderState,
  appendSessionId,
  getPlanProgress,
  getFirstIncompleteTask,
  getCurrentPhase,
  isExecutingPhase,
  markBoulderComplete,
  updatePhaseStatus,
  incrementRetry,
  isMaxRetries,
  resetRetry,
} from "../../features/boulder-state"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { createSystemDirective, SYSTEM_DIRECTIVE_PREFIX, SystemDirectiveTypes } from "../../shared/system-directive"
import { isCallerOrchestrator, getMessageDir } from "../../shared/session-utils"
import { isBlockedResponse } from "../../shared/blocked-task-detector"
import type { BackgroundManager } from "../../features/background-agent"
import { isInCompactionCooldown, getCompactionCooldownRemaining } from "../compaction-state"

export const HOOK_NAME = "atlas"

/**
 * Cross-platform check if a path is inside .sisyphus/ directory.
 * Handles both forward slashes (Unix) and backslashes (Windows).
 */
function isSisyphusPath(filePath: string): boolean {
  return /\.sisyphus[/\\]/.test(filePath)
}

const WRITE_EDIT_TOOLS = ["Write", "Edit", "write", "edit"]

const DIRECT_WORK_REMINDER = `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

You just performed direct file modifications outside \`.sisyphus/\`.

**You are an ORCHESTRATOR, not an IMPLEMENTER.**

As an orchestrator, you should:
- **DELEGATE** implementation work to subagents via \`delegate_task\`
- **VERIFY** the work done by subagents
- **COORDINATE** multiple tasks and ensure completion

You should NOT:
- Write code directly (except for \`.sisyphus/\` files like plans and notepads)
- Make direct file edits outside \`.sisyphus/\`
- Implement features yourself

**If you need to make changes:**
1. Use \`delegate_task\` to delegate to an appropriate subagent
2. Provide clear instructions in the prompt
3. Verify the subagent's work after completion

---
`

const BOULDER_CONTINUATION_PROMPT = `${createSystemDirective(SystemDirectiveTypes.BOULDER_CONTINUATION)}

You have an active work plan with incomplete tasks. Continue working.

**PLAN FILE LOCATION**: \`{TASKS_PATH}\`

RULES:
- Proceed without asking for permission
- Mark each checkbox [x] in the plan file when done
- Use the notepad at .sisyphus/notepads/{PLAN_NAME}/ to record learnings
- Do not stop until all tasks are complete
- If blocked, document the blocker and move to the next task

**MANDATORY FIRST ACTION** (Context Loading):
1. Use \`progressive-disclosure-md\` skill to read tasks.md:
   \`\`\`bash
   node ~/.claude/skills/progressive-disclosure-md/cli/dist/cli.mjs {TASKS_PATH}
   \`\`\`

2. Parse each \`### Task X.Y: [Title]\` and write to \`todowrite\`:
   - id: "task-X.Y"
   - content: "[Title] - [Description first sentence]"
   - priority: Phase 1 = high, Phase 2 = medium, Phase 3+ = low
   - status: Based on checkbox - \`[x]\` = completed, \`[ ]\` = pending, \`[~]\` = in_progress
   
   **IMPORTANT**: Only write incomplete tasks (\`[ ]\` or \`[~]\`) to todo.

SYNC REQUIREMENT (tasks.md is source of truth):
After reading this message, you MUST:
1. **Read the plan file at \`{TASKS_PATH}\`** to get the authoritative task list
2. Use todowrite to update your todo list:
   - Add any tasks from tasks.md that are missing in todo
   - Keep any extra todo items not in tasks.md (merge-preserve)
   - Match task names exactly as they appear in tasks.md
3. Work from \`{TASKS_PATH}\` checkboxes, not from memory or old todo state
4. **When completing tasks, edit \`{TASKS_PATH}\` directly** to check off: \`- [x]\``

const EXECUTION_MODE_AUTO_DECISION = `
---

## 🔄 EXECUTION MODE AUTO-DECISION (Task 8.2)

When you have a tasks.md ready for execution, **automatically select** the execution mode:

| Task Count | Mode | Skill |
|------------|------|-------|
| **≤ 5 tasks** | Sequential | \`executing-plans\` |
| **> 5 tasks** | Wave-Parallel | \`wave-parallel-execution\` |

**DO NOT ask user to choose.** Count tasks and announce:

"Based on task count ([N] tasks):
→ Selected mode: [Sequential/Wave-Parallel]
→ Loading skill: [executing-plans/wave-parallel-execution]"

**Override only if user explicitly says:**
- "use sequential" → Force executing-plans
- "use parallel" / "use wave" → Force wave-parallel-execution

---
`

const ARCHIVER_DISPATCH_PROMPT = `
---

## 🎉 PHASE 3 READY - ALL TASKS COMPLETE

All planned tasks have been completed. Execute Phase 3 completion in order:

### Step 3.1: Verification (MANDATORY FIRST)

**BEFORE anything else, load and execute verification skill:**

\`\`\`
skill("verification-before-completion")
\`\`\`

Run through the checklist:
- [ ] All acceptance criteria met
- [ ] All tests pass (run them yourself, don't trust reports)
- [ ] \`lsp_diagnostics\` clean on ALL changed files
- [ ] No debug logs or TODO comments left
- [ ] Build passes: \`bun run build\` or equivalent

**⚠️ IF ANY CHECK FAILS → Return to Phase 2B to fix issues. DO NOT proceed.**

### Step 3.2: Git Strategy Selection

**Ask user which strategy to use:**

"All verification passed. Choose git strategy:
1. **merge** - Merge feature branch to main locally
2. **pr** - Push and create Pull Request
3. **keep** - Keep branch as-is (don't merge yet)
4. **discard** - Discard all changes"

Wait for user response.

### Step 3.3: Dispatch Archiver

**After user selects strategy, dispatch Archiver:**

\`\`\`
sisyphus_task(
  agent="archiver",
  prompt="""
  Execute Phase 3 completion:
  
  1. TASK: Execute git strategy and archive changes
  2. GIT_STRATEGY: [user's choice from Step 3.2]
  3. PROJECT_ROOT: ${process.cwd()}
  4. CHANGE_NAME: [current feature name]
  5. BUILD_COMMAND: bun run build
  
  REQUIRED SKILLS:
  - finishing-a-development-branch
  - archiving-changes
  
  MUST DO:
  - Execute the git strategy user selected
  - Archive to changes/archive/YYYY-MM-DD-{name}/
  - Generate metadata.json with commit SHAs and file list
  - Clean up worktrees if any
  
  MUST NOT DO:
  - Skip git strategy execution
  - Archive without user confirmation
  """
)
\`\`\`

---
`

const VERIFICATION_REMINDER = `**MANDATORY VERIFICATION - SUBAGENTS LIE**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: Subagents FREQUENTLY LIE about completion.
Tests FAILING, code has ERRORS, implementation INCOMPLETE - but they say "done".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**STEP 1: VERIFY WITH YOUR OWN TOOL CALLS (DO THIS NOW)**

**⚠️ LSP_DIAGNOSTICS IS MANDATORY ⚠️**

Before marking ANY task complete, you MUST run:
\`\`\`
lsp_diagnostics(filePath="path/to/changed/file.ts")
\`\`\`

| File Type | Required Check |
|-----------|----------------|
| \`.ts\`, \`.tsx\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.js\`, \`.jsx\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.py\` | \`lsp_diagnostics\` - Must show 0 errors |
| \`.go\` | \`lsp_diagnostics\` - Must show 0 errors |

**IF LSP_DIAGNOSTICS SHOWS ERRORS:**
1. DO NOT mark task complete
2. Use \`sisyphus_task(resume=session_id, prompt="fix: [error details]")\`
3. Re-run \`lsp_diagnostics\` after fix
4. Only mark complete when diagnostics are CLEAN

**HANDS-ON QA REQUIRED (after ALL tasks complete):**

**STEP 2: DETERMINE IF HANDS-ON QA IS NEEDED**

| Deliverable Type | QA Method | Tool |
|------------------|-----------|------|
| **Frontend/UI** | Browser interaction | \`/playwright\` skill |
| **TUI/CLI** | Run interactively | \`interactive_bash\` (tmux) |
| **API/Backend** | Send real requests | \`bash\` with curl |

Static analysis CANNOT catch: visual bugs, animation issues, user flow breakages.

**STEP 3: IF QA IS NEEDED - ADD TO TODO IMMEDIATELY**

\`\`\`
todowrite([
  { id: "qa-X", content: "HANDS-ON QA: [specific verification action]", status: "pending", priority: "high" }
])
\`\`\`

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**BLOCKING: DO NOT proceed to Step 4 until Steps 1-3 are VERIFIED.**`

const ORCHESTRATOR_DELEGATION_REQUIRED = `

---

${createSystemDirective(SystemDirectiveTypes.DELEGATION_REQUIRED)}

**STOP. YOU ARE VIOLATING ORCHESTRATOR PROTOCOL.**

You (Atlas) are attempting to directly modify a file outside \`.sisyphus/\`.

**Path attempted:** $FILE_PATH

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**THIS IS FORBIDDEN** (except for VERIFICATION purposes)

As an ORCHESTRATOR, you MUST:
1. **DELEGATE** all implementation work via \`delegate_task\`
2. **VERIFY** the work done by subagents (reading files is OK)
3. **COORDINATE** - you orchestrate, you don't implement

**ALLOWED direct file operations:**
- Files inside \`.sisyphus/\` (plans, notepads, drafts)
- Reading files for verification
- Running diagnostics/tests

**FORBIDDEN direct file operations:**
- Writing/editing source code
- Creating new files outside \`.sisyphus/\`
- Any implementation work

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IF THIS IS FOR VERIFICATION:**
Proceed if you are verifying subagent work by making a small fix.
But for any substantial changes, USE \`delegate_task\`.

**CORRECT APPROACH:**
\`\`\`
delegate_task(
  category="...",
  prompt="[specific single task with clear acceptance criteria]"
)
\`\`\`

DELEGATE. DON'T IMPLEMENT.

---
`

const SINGLE_TASK_DIRECTIVE = `

${createSystemDirective(SystemDirectiveTypes.SINGLE_TASK_ONLY)}

**STOP. READ THIS BEFORE PROCEEDING.**

If you were NOT given **exactly ONE atomic task**, you MUST:
1. **IMMEDIATELY REFUSE** this request
2. **DEMAND** the orchestrator provide a single, specific task

**Your response if multiple tasks detected:**
> "I refuse to proceed. You provided multiple tasks. An orchestrator's impatience destroys work quality.
> 
> PROVIDE EXACTLY ONE TASK. One file. One change. One verification.
> 
> Your rushing will cause: incomplete work, missed edge cases, broken tests, wasted context."

**WARNING TO ORCHESTRATOR:**
- Your hasty batching RUINS deliverables
- Each task needs FULL attention and PROPER verification  
- Batch delegation = sloppy work = rework = wasted tokens

**REFUSE multi-task requests. DEMAND single-task clarity.**
`

function buildVerificationReminder(sessionId: string): string {
   return `${VERIFICATION_REMINDER}

---

**If ANY verification fails, use this immediately:**
\`\`\`
delegate_task(session_id="${sessionId}", prompt="fix: [describe the specific failure]")
\`\`\``
}

function buildOrchestratorReminder(planName: string, progress: { total: number; completed: number }, sessionId: string): string {
  const remaining = progress.total - progress.completed
  return `
---

**BOULDER STATE:** Plan: \`${planName}\` | ${progress.completed}/${progress.total} done | ${remaining} remaining

---

${buildVerificationReminder(sessionId)}

**STEP 4: MARK COMPLETION IN PLAN FILE (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

Update the plan file \`.sisyphus/tasks/${planName}.yaml\`:
- Change \`[ ]\` to \`[x]\` for the completed task
- Use \`Edit\` tool to modify the checkbox

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 5: COMMIT ATOMIC UNIT**

- Stage ONLY the verified changes
- Commit with clear message describing what was done

**STEP 6: PROCEED TO NEXT TASK**

- Read the plan file to identify the next \`[ ]\` task
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**${remaining} tasks remain. Keep bouldering.**`
}

function buildStandaloneVerificationReminder(sessionId: string): string {
  return `
---

${buildVerificationReminder(sessionId)}

**STEP 4: UPDATE TODO STATUS (IMMEDIATELY)**

RIGHT NOW - Do not delay. Verification passed → Mark IMMEDIATELY.

1. Run \`todoread\` to see your todo list
2. Mark the completed task as \`completed\` using \`todowrite\`

**DO THIS BEFORE ANYTHING ELSE. Unmarked = Untracked = Lost progress.**

**STEP 5: EXECUTE QA TASKS (IF ANY)**

If QA tasks exist in your todo list:
- Execute them BEFORE proceeding
- Mark each QA task complete after successful verification

**STEP 6: PROCEED TO NEXT PENDING TASK**

- Identify the next \`pending\` task from your todo list
- Start immediately - DO NOT STOP

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**NO TODO = NO TRACKING = INCOMPLETE WORK. Use todowrite aggressively.**`
}

function extractSessionIdFromOutput(output: string): string {
  const match = output.match(/Session ID:\s*(ses_[a-zA-Z0-9]+)/)
  return match?.[1] ?? "<session_id>"
}

interface GitFileStat {
  path: string
  added: number
  removed: number
  status: "modified" | "added" | "deleted"
}

function getGitDiffStats(directory: string): GitFileStat[] {
  try {
    const output = execSync("git diff --numstat HEAD", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    if (!output) return []

    const statusOutput = execSync("git status --porcelain", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    const statusMap = new Map<string, "modified" | "added" | "deleted">()
    for (const line of statusOutput.split("\n")) {
      if (!line) continue
      const status = line.substring(0, 2).trim()
      const filePath = line.substring(3)
      if (status === "A" || status === "??") {
        statusMap.set(filePath, "added")
      } else if (status === "D") {
        statusMap.set(filePath, "deleted")
      } else {
        statusMap.set(filePath, "modified")
      }
    }

    const stats: GitFileStat[] = []
    for (const line of output.split("\n")) {
      const parts = line.split("\t")
      if (parts.length < 3) continue

      const [addedStr, removedStr, path] = parts
      const added = addedStr === "-" ? 0 : parseInt(addedStr, 10)
      const removed = removedStr === "-" ? 0 : parseInt(removedStr, 10)

      stats.push({
        path,
        added,
        removed,
        status: statusMap.get(path) ?? "modified",
      })
    }

    return stats
  } catch {
    return []
  }
}

function formatFileChanges(stats: GitFileStat[], notepadPath?: string): string {
  if (stats.length === 0) return "[FILE CHANGES SUMMARY]\nNo file changes detected.\n"

  const modified = stats.filter((s) => s.status === "modified")
  const added = stats.filter((s) => s.status === "added")
  const deleted = stats.filter((s) => s.status === "deleted")

  const lines: string[] = ["[FILE CHANGES SUMMARY]"]

  if (modified.length > 0) {
    lines.push("Modified files:")
    for (const f of modified) {
      lines.push(`  ${f.path}  (+${f.added}, -${f.removed})`)
    }
    lines.push("")
  }

  if (added.length > 0) {
    lines.push("Created files:")
    for (const f of added) {
      lines.push(`  ${f.path}  (+${f.added})`)
    }
    lines.push("")
  }

  if (deleted.length > 0) {
    lines.push("Deleted files:")
    for (const f of deleted) {
      lines.push(`  ${f.path}  (-${f.removed})`)
    }
    lines.push("")
  }

  if (notepadPath) {
    const notepadStat = stats.find((s) => s.path.includes("notepad") || s.path.includes(".sisyphus"))
    if (notepadStat) {
      lines.push("[NOTEPAD UPDATED]")
      lines.push(`  ${notepadStat.path}  (+${notepadStat.added})`)
      lines.push("")
    }
  }

  return lines.join("\n")
}

interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

interface SessionState {
  lastEventWasAbortError?: boolean
  lastContinuationInjectedAt?: number
  lastToolExecutionAt?: number
}

const CONTINUATION_COOLDOWN_MS = 5000
const POST_TOOL_COOLDOWN_MS = 10000

export interface AtlasHookOptions {
  directory: string
  backgroundManager?: BackgroundManager
}

function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""

    if (name === "MessageAbortedError" || name === "AbortError") return true
    if (name === "DOMException" && message.includes("abort")) return true
    if (message.includes("aborted") || message.includes("cancelled") || message.includes("interrupted")) return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

export function createAtlasHook(
  ctx: PluginInput,
  options?: AtlasHookOptions
) {
  const backgroundManager = options?.backgroundManager
  const sessions = new Map<string, SessionState>()
  const pendingFilePaths = new Map<string, string>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  async function injectContinuation(sessionID: string, planName: string, tasksPath: string, remaining: number, total: number): Promise<void> {
    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    const prompt = BOULDER_CONTINUATION_PROMPT
      .replace(/{PLAN_NAME}/g, planName)
      .replace(/{TASKS_PATH}/g, tasksPath) +
      `\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting boulder continuation`, { sessionID, planName, remaining })

      let model: { providerID: string; modelID: string } | undefined
      try {
        const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
        const messages = (messagesResp.data ?? []) as Array<{
          info?: { model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
        }>
        for (let i = messages.length - 1; i >= 0; i--) {
          const info = messages[i].info
          const msgModel = info?.model
          if (msgModel?.providerID && msgModel?.modelID) {
            model = { providerID: msgModel.providerID, modelID: msgModel.modelID }
            break
          }
          if (info?.providerID && info?.modelID) {
            model = { providerID: info.providerID, modelID: info.modelID }
            break
          }
        }
      } catch {
        const messageDir = getMessageDir(sessionID)
        const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
        model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
          ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
          : undefined
      }

       await ctx.client.session.prompt({
         path: { id: sessionID },
         body: {
            agent: "atlas",
           ...(model !== undefined ? { model } : {}),
           parts: [{ type: "text", text: prompt }],
         },
         query: { directory: ctx.directory },
       })

      log(`[${HOOK_NAME}] Boulder continuation injected`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Boulder continuation failed`, { sessionID, error: String(err) })
    }
  }

  return {
    handler: async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        const state = getState(sessionID)
        const isAbort = isAbortError(props?.error)
        state.lastEventWasAbortError = isAbort
        
        // Detect context limit errors which trigger compaction
        // Note: This is a fallback - the main compaction detection is via onSummarize hook
        // in compaction-context-injector which uses shared compaction-state
        const error = props?.error as Record<string, unknown> | undefined
        const errorStr = JSON.stringify(error ?? {}).toLowerCase()
        if (errorStr.includes("prompt is too long") || 
            errorStr.includes("context limit") || 
            errorStr.includes("server-side context limit") ||
            errorStr.includes("token") && errorStr.includes("limit")) {
          log(`[${HOOK_NAME}] Context limit error detected`, { sessionID, errorStr: errorStr.slice(0, 200) })
        }

        log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort })
        return
      }

      if (event.type === "session.idle") {
        const sessionID = props?.sessionID as string | undefined
        if (!sessionID) return

        log(`[${HOOK_NAME}] session.idle`, { sessionID })

        // Read boulder state FIRST to check if this session is part of an active boulder
        const boulderState = readBoulderState(ctx.directory)
        const isBoulderSession = boulderState?.session_ids.includes(sessionID) ?? false

        const mainSessionID = getMainSessionID()
        const isMainSession = sessionID === mainSessionID
        const isBackgroundTaskSession = subagentSessions.has(sessionID)

        // Allow continuation if: main session OR background task OR boulder session
        if (mainSessionID && !isMainSession && !isBackgroundTaskSession && !isBoulderSession) {
          log(`[${HOOK_NAME}] Skipped: not main, background task, or boulder session`, { sessionID })
          return
        }

        const state = getState(sessionID)

        if (state.lastEventWasAbortError) {
          state.lastEventWasAbortError = false
          log(`[${HOOK_NAME}] Skipped: abort error immediately before idle`, { sessionID })
          return
        }

        const hasRunningBgTasks = backgroundManager
          ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
          : false

        if (hasRunningBgTasks) {
          log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
          return
        }

        // Post-tool execution cooldown (prevents interrupting active work)
        if (state.lastToolExecutionAt) {
          const timeSinceToolExec = Date.now() - state.lastToolExecutionAt
          if (timeSinceToolExec < POST_TOOL_COOLDOWN_MS) {
            log(`[${HOOK_NAME}] Skipped: post-tool cooldown active (${timeSinceToolExec}ms < ${POST_TOOL_COOLDOWN_MS}ms)`, { sessionID })
            return
          }
        }

        // Post-compact cooldown (1 minute after compact, don't auto-continue)
        if (isInCompactionCooldown(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: post-compact cooldown active`, { sessionID, cooldownRemaining: getCompactionCooldownRemaining(sessionID) })
          return
        }


        if (!boulderState) {
          log(`[${HOOK_NAME}] No active boulder`, { sessionID })
          return
        }

        // CRITICAL: Check if current session is in boulder's session_ids
        // This ensures Boulder continuation only triggers for sessions that started/joined the boulder
        if (!boulderState.session_ids.includes(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: session not in boulder session_ids`, { 
            sessionID, 
            plan: boulderState.plan_name,
            allowedSessions: boulderState.session_ids 
          })
          return
        }

        if (!isCallerOrchestrator(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: last agent is not Atlas`, { sessionID })
          return
        }

        // CRITICAL: Check if boulder is already completed OR awaiting user input to prevent repeated Phase 3 triggers
        if (boulderState.phase === "completed" || boulderState.phase === "awaiting_user" || boulderState.completed_at) {
          log(`[${HOOK_NAME}] Boulder in terminal state (${boulderState.phase}), skipping Phase 3`, { sessionID, plan: boulderState.plan_name })
          return
        }

        const progress = getPlanProgress(boulderState.active_plan)
        if (progress.isComplete) {
          log(`[${HOOK_NAME}] Boulder complete - triggering Phase 3`, { sessionID, plan: boulderState.plan_name })
          
          // Set phase to awaiting_user FIRST to prevent repeated triggers
          // This blocks future session.idle events from re-injecting Phase 3
          const { updatePhaseStatus } = await import("../../features/boulder-state/storage")
          updatePhaseStatus(ctx.directory, "awaiting_user")
          log(`[${HOOK_NAME}] Boulder phase set to awaiting_user`, { sessionID, plan: boulderState.plan_name })
          
          // Inject Archiver dispatch prompt when all tasks are complete
          try {
            await ctx.client.session.prompt({
              path: { id: sessionID },
              body: {
                agent: "orchestrator-sisyphus",
                parts: [{ type: "text", text: ARCHIVER_DISPATCH_PROMPT.replace("${process.cwd()}", ctx.directory) }],
              },
              query: { directory: ctx.directory },
            })
            log(`[${HOOK_NAME}] Archiver dispatch prompt injected`, { sessionID })
          } catch (err) {
            log(`[${HOOK_NAME}] Archiver dispatch prompt failed`, { sessionID, error: String(err) })
          }
          return
        }

        const now = Date.now()
        
        // Check post-compact cooldown (1 minute after compact, don't remind)
        // Uses shared state from compaction-context-injector via onSummarize hook
        if (isInCompactionCooldown(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: post-compact cooldown active`, { sessionID, cooldownRemaining: getCompactionCooldownRemaining(sessionID) })
          return
        }
        
        if (state.lastContinuationInjectedAt && now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS) {
          log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, { sessionID, cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - state.lastContinuationInjectedAt) })
          return
        }

        // Check for blocked response in last assistant message
        try {
          const messagesResp = await ctx.client.session.messages({
            path: { id: sessionID },
            query: { directory: ctx.directory },
          })
          const messages = (messagesResp as { data?: Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }> }).data ?? []
          
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i]
            if (msg.info?.role === "assistant" && msg.parts) {
              const assistantContent = msg.parts
                .filter(p => p.type === "text" && p.text)
                .map(p => p.text)
                .join(" ")
              
              if (isBlockedResponse(assistantContent)) {
                // Use fine-grained task ID: plan::currentTask
                const currentTask = getFirstIncompleteTask(boulderState.active_plan)
                const taskId = currentTask 
                  ? `${boulderState.plan_name}::${currentTask}`
                  : boulderState.plan_name
                const retryCount = incrementRetry(ctx.directory, taskId, assistantContent.slice(0, 200))
                
                if (isMaxRetries(ctx.directory, taskId)) {
                  // Update boulder phase to blocked
                  updatePhaseStatus(ctx.directory, "blocked")
                  log(`[${HOOK_NAME}] Task blocked after ${retryCount} retries`, { 
                    sessionID, 
                    plan: boulderState.plan_name,
                    task: currentTask,
                    preview: assistantContent.slice(0, 100) 
                  })
                  return
                }
                
                log(`[${HOOK_NAME}] Blocked response detected, retry ${retryCount}/3`, { 
                  sessionID, 
                  plan: boulderState.plan_name,
                  task: currentTask,
                  preview: assistantContent.slice(0, 100) 
                })
              } else {
                // Reset retry counter for current task on non-blocked response
                const currentTask = getFirstIncompleteTask(boulderState.active_plan)
                const taskId = currentTask 
                  ? `${boulderState.plan_name}::${currentTask}`
                  : boulderState.plan_name
                resetRetry(ctx.directory, taskId)
              }
              break
            }
          }
        } catch (err) {
          log(`[${HOOK_NAME}] Failed to check for blocked response`, { sessionID, error: String(err) })
        }

        state.lastContinuationInjectedAt = now
        const remaining = progress.total - progress.completed
        injectContinuation(sessionID, boulderState.plan_name, boulderState.active_plan, remaining, progress.total)
        return
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined
        const agent = info?.agent as string | undefined

        if (!sessionID) return

        // Detect compaction agent - trigger cooldown to prevent boulder-reminder conflict
        if (agent === "compaction") {
          const { markCompaction } = await import("../compaction-state")
          markCompaction(sessionID)
          log(`[${HOOK_NAME}] Compaction agent detected, starting 1-minute cooldown`, { sessionID })
          return
        }

        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
        return
      }

      if (event.type === "message.part.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined
        const role = info?.role as string | undefined

        if (sessionID && role === "assistant") {
          const state = sessions.get(sessionID)
          if (state) {
            state.lastEventWasAbortError = false
          }
        }
        return
      }

      if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
        const sessionID = props?.sessionID as string | undefined
        if (sessionID) {
          const state = getState(sessionID)
          state.lastEventWasAbortError = false
          // Track last tool execution to prevent interrupting active work
          if (event.type === "tool.execute.after") {
            state.lastToolExecutionAt = Date.now()
          }
        }
        return
      }

      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined
        if (sessionInfo?.id) {
          sessions.delete(sessionInfo.id)
          log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
        }
        return
      }

      // Note: Compaction is now tracked via shared compaction-state module
      // which is updated by compaction-context-injector's onSummarize hook
    },

    "tool.execute.before": async (
      input: { tool: string; sessionID?: string; callID?: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      // Check Write/Edit tools for orchestrator - inject strong warning
      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        const filePath = (output.args.filePath ?? output.args.path ?? output.args.file) as string | undefined
        if (filePath && !isSisyphusPath(filePath)) {
          // Store filePath for use in tool.execute.after
          if (input.callID) {
            pendingFilePaths.set(input.callID, filePath)
          }
          const warning = ORCHESTRATOR_DELEGATION_REQUIRED.replace("$FILE_PATH", filePath)
          output.message = (output.message || "") + warning
          log(`[${HOOK_NAME}] Injected delegation warning for direct file modification`, {
            sessionID: input.sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      // Check sisyphus_task - inject single-task directive and Phase enforcement (Task 9.3)
      if (input.tool === "sisyphus_task" || input.tool === "delegate_task") {
        const subagentType = (output.args.subagent_type as string | undefined)?.toLowerCase() || ""
        const prompt = output.args.prompt as string | undefined
        // Phase enforcement (Task 9.3): Block planning agents during executing phase
        const planningAgents = ["metis", "prometheus", "momus", "planner", "plan consultant", "plan reviewer"]
        const isPlanningAgent = planningAgents.some(agent => subagentType.includes(agent))

        if (isPlanningAgent && isExecutingPhase(ctx.directory)) {
          const currentPhase = getCurrentPhase(ctx.directory)
          const phaseWarning = `

---

🛑 **PHASE ENFORCEMENT VIOLATION (Task 9.3)**

You are attempting to call a **planning agent** (${subagentType}) while in **executing phase**.

| Current Phase | Target Agent | Allowed? |
|---------------|--------------|----------|
| ${currentPhase} | ${subagentType} | ❌ NO |

**Rule**: During \`executing\` phase, planning agents (Metis, Prometheus, Momus) are blocked.

**Options:**
1. Complete current execution, then use \`/reset-phase\` to restart planning
2. If you truly need to re-plan, ask user for confirmation first
3. Continue with execution tasks instead

**Proceeding anyway, but this is a workflow violation.**

---
`
          output.message = (output.message || "") + phaseWarning
          log(`[${HOOK_NAME}] Phase enforcement warning: planning agent called during executing`, {
            sessionID: input.sessionID,
            subagentType,
            currentPhase,
          })
        }

        if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
          output.args.prompt = `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n` + prompt
          log(`[${HOOK_NAME}] Injected single-task directive to delegate_task`, {
            sessionID: input.sessionID,
          })
        }
      }
    },

    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ): Promise<void> => {
      // Track skill calls for phase updates (Task 13)
      if (input.tool === "skill") {
        const skillName = (output.metadata?.name ?? output.metadata?.skillName ?? "") as string
        const skillNameLower = skillName.toLowerCase()
        
        try {
          if (skillNameLower.includes("brainstorming")) {
            updatePhaseStatus(ctx.directory, "planning")
            log(`[${HOOK_NAME}] Skill phase tracking: brainstorming → planning`, { sessionID: input.sessionID })
          } else if (skillNameLower.includes("executing-plans") || skillNameLower.includes("wave-parallel")) {
            updatePhaseStatus(ctx.directory, "executing")
            log(`[${HOOK_NAME}] Skill phase tracking: execution skill → executing`, { sessionID: input.sessionID })
          } else if (skillNameLower.includes("finishing-a-development-branch")) {
            updatePhaseStatus(ctx.directory, "awaiting_user")
            log(`[${HOOK_NAME}] Skill phase tracking: finishing → awaiting_user`, { sessionID: input.sessionID })
          } else if (skillNameLower.includes("archiving-changes")) {
            updatePhaseStatus(ctx.directory, "completed")
            log(`[${HOOK_NAME}] Skill phase tracking: archiving → completed`, { sessionID: input.sessionID })
          }
        } catch (err) {
          log(`[${HOOK_NAME}] Skill phase tracking failed`, { sessionID: input.sessionID, skill: skillName, error: String(err) })
        }
      }

      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        let filePath = input.callID ? pendingFilePaths.get(input.callID) : undefined
        if (input.callID) {
          pendingFilePaths.delete(input.callID)
        }
        if (!filePath) {
          filePath = output.metadata?.filePath as string | undefined
        }
        if (filePath && !isSisyphusPath(filePath)) {
          output.output = (output.output || "") + DIRECT_WORK_REMINDER
          log(`[${HOOK_NAME}] Direct work reminder appended`, {
            sessionID: input.sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      if (input.tool !== "delegate_task") {
        return
      }

       const outputStr = output.output && typeof output.output === "string" ? output.output : ""
       const isBackgroundLaunch = outputStr.includes("Background task launched") || outputStr.includes("Background task continued")
      
      if (isBackgroundLaunch) {
        return
      }
      
      if (output.output && typeof output.output === "string") {
        const gitStats = getGitDiffStats(ctx.directory)
        const fileChanges = formatFileChanges(gitStats)
        const subagentSessionId = extractSessionIdFromOutput(output.output)

        const boulderState = readBoulderState(ctx.directory)

        if (boulderState) {
          const progress = getPlanProgress(boulderState.active_plan)

          if (input.sessionID && !boulderState.session_ids.includes(input.sessionID)) {
            appendSessionId(ctx.directory, input.sessionID)
            log(`[${HOOK_NAME}] Appended session to boulder`, {
              sessionID: input.sessionID,
              plan: boulderState.plan_name,
            })
          }

          // Preserve original subagent response - critical for debugging failed tasks
          const originalResponse = output.output

          output.output = `
## SUBAGENT WORK COMPLETED

${fileChanges}

---

**Subagent Response:**

${originalResponse}

<system-reminder>
${buildOrchestratorReminder(boulderState.plan_name, progress, subagentSessionId)}
</system-reminder>`

          log(`[${HOOK_NAME}] Output transformed for orchestrator mode (boulder)`, {
            plan: boulderState.plan_name,
            progress: `${progress.completed}/${progress.total}`,
            fileCount: gitStats.length,
          })
        } else {
          output.output += `\n<system-reminder>\n${buildStandaloneVerificationReminder(subagentSessionId)}\n</system-reminder>`

          log(`[${HOOK_NAME}] Verification reminder appended for orchestrator`, {
            sessionID: input.sessionID,
            fileCount: gitStats.length,
          })
        }
      }
    },
  }
}
