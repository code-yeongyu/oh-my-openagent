import type { PluginInput } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import {
  readBoulderState,
  appendSessionId,
  getPlanProgress,
} from "../../features/boulder-state"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { log } from "../../shared/logger"
import { createSystemDirective, SYSTEM_DIRECTIVE_PREFIX, SystemDirectiveTypes } from "../../shared/system-directive"
import { isCallerOrchestrator, getMessageDir } from "../../shared/session-utils"
import type { BackgroundManager } from "../../features/background-agent"

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

RULES:
- Proceed without asking for permission
- Mark each checkbox [x] in the plan file when done
- Use the notepad at .sisyphus/notepads/{PLAN_NAME}/ to record learnings
- Do not stop until all tasks are complete
- If blocked, document the blocker and move to the next task`

const VERIFICATION_REMINDER = `**MANDATORY: WHAT YOU MUST DO RIGHT NOW**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CRITICAL: Subagents FREQUENTLY LIE about completion.
Tests FAILING, code has ERRORS, implementation INCOMPLETE - but they say "done".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**STEP 1: VERIFY WITH YOUR OWN TOOL CALLS (DO THIS NOW)**

Run these commands YOURSELF - do NOT trust agent's claims:
1. \`lsp_diagnostics\` on changed files → Must be CLEAN
2. \`bash\` to run tests → Must PASS
3. \`bash\` to run build/typecheck → Must succeed
4. \`Read\` the actual code → Must match requirements

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
}

const CONTINUATION_COOLDOWN_MS = 5000

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

  async function injectContinuation(sessionID: string, planName: string, remaining: number, total: number): Promise<void> {
    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    const prompt = BOULDER_CONTINUATION_PROMPT
      .replace(/{PLAN_NAME}/g, planName) +
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


        if (!boulderState) {
          log(`[${HOOK_NAME}] No active boulder`, { sessionID })
          return
        }

        if (!isCallerOrchestrator(sessionID)) {
          log(`[${HOOK_NAME}] Skipped: last agent is not Atlas`, { sessionID })
          return
        }

        const progress = getPlanProgress(boulderState.active_plan)
        if (progress.isComplete) {
          log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
          return
        }

        const now = Date.now()
        if (state.lastContinuationInjectedAt && now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS) {
          log(`[${HOOK_NAME}] Skipped: continuation cooldown active`, { sessionID, cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - state.lastContinuationInjectedAt) })
          return
        }

        state.lastContinuationInjectedAt = now
        const remaining = progress.total - progress.completed
        injectContinuation(sessionID, boulderState.plan_name, remaining, progress.total)
        return
      }

      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined
        const sessionID = info?.sessionID as string | undefined

        if (!sessionID) return

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
          const state = sessions.get(sessionID)
          if (state) {
            state.lastEventWasAbortError = false
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

      // Check delegate_task - inject single-task directive
      if (input.tool === "delegate_task") {
        const prompt = output.args.prompt as string | undefined
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
      // Guard against undefined output (e.g., from /review command - see issue #1035)
      if (!output) {
        return
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
