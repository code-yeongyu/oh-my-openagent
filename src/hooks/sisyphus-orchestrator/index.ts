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
import type { BackgroundManager } from "../../features/background-agent"

export const HOOK_NAME = "sisyphus-orchestrator"

const ALLOWED_PATH_PREFIX = ".sisyphus/"
const WRITE_EDIT_TOOLS = ["Write", "Edit", "write", "edit"]

const DIRECT_WORK_REMINDER = `

---

[SYSTEM REMINDER - DELEGATION REQUIRED]

You just performed direct file modifications outside \`.sisyphus/\`.

**Sisyphus is an ORCHESTRATOR, not an IMPLEMENTER.**

As an orchestrator, you should:
- **DELEGATE** implementation work to subagents via \`sisyphus_task\`
- **VERIFY** the work done by subagents
- **COORDINATE** multiple tasks and ensure completion

You should NOT:
- Write code directly (except for \`.sisyphus/\` files like plans and notepads)
- Make direct file edits outside \`.sisyphus/\`
- Implement features yourself

**If you need to make changes:**
1. Use \`sisyphus_task\` to delegate to an appropriate subagent
2. Provide clear instructions in the prompt
3. Verify the subagent's work after completion

---
`

const BOULDER_CONTINUATION_PROMPT = `[SYSTEM REMINDER - BOULDER CONTINUATION]

You have an active work plan with incomplete tasks. Continue working.

RULES:
- Proceed without asking for permission
- Mark each checkbox [x] in the plan file when done
- Use the notepad at .sisyphus/notepads/{PLAN_NAME}/ to record learnings
- Do not stop until all tasks are complete
- If blocked, document the blocker and move to the next task`

const VERIFICATION_REMINDER = `**MANDATORY VERIFICATION - SUBAGENTS LIE**

Subagents FREQUENTLY claim completion when:
- Tests are actually FAILING
- Code has type/lint ERRORS
- Implementation is INCOMPLETE
- Patterns were NOT followed

**YOU MUST VERIFY EVERYTHING YOURSELF:**

1. Run \`lsp_diagnostics\` on changed files - Must be CLEAN
2. Run tests yourself - Must PASS (not "agent said it passed")
3. Read the actual code - Must match requirements
4. Check build/typecheck - Must succeed
5. Verify notepad was updated - Must have substantive content

DO NOT TRUST THE AGENT'S SELF-REPORT.
They are non-deterministic and not exceptional - they CANNOT distinguish between completed and incomplete states.
VERIFY EACH CLAIM WITH YOUR OWN TOOL CALLS.

**HANDS-ON QA REQUIRED (after ALL tasks complete):**

| Deliverable Type | Verification Tool | Action |
|------------------|-------------------|--------|
| **Frontend/UI** | \`/playwright\` skill | Navigate, interact, screenshot evidence |
| **TUI/CLI** | \`interactive_bash\` (tmux) | Run interactively, verify output |
| **API/Backend** | \`bash\` with curl | Send requests, verify responses |

Static analysis CANNOT catch: visual bugs, animation issues, user flow breakages, integration problems.
**FAILURE TO DO HANDS-ON QA = INCOMPLETE WORK.**`

function buildOrchestratorReminder(planName: string, progress: { total: number; completed: number }): string {
  const remaining = progress.total - progress.completed
  return `
---

**State:** \`.sisyphus/boulder.json\` | Plan: ${planName} | ${progress.completed}/${progress.total} done, ${remaining} left

**Notepad:** \`.sisyphus/notepads/${planName}/{category}.md\`

---

${VERIFICATION_REMINDER}

**COMMIT FREQUENTLY:**
- Commit after each verified task unit - one logical change per commit
- Do NOT accumulate multiple tasks into one big commit
- Atomic commits make rollback and review easier
- If verification passes, commit immediately before moving on

**THEN:**
- Broken? \`sisyphus_task(resume="<session_id>", prompt="fix: ...")\`
- Verified? Commit atomic unit, mark \`- [ ]\` to \`- [x]\`, next task`
}

function buildStandaloneVerificationReminder(): string {
  return `
---

## SISYPHUS_TASK COMPLETED - VERIFICATION REQUIRED

${VERIFICATION_REMINDER}

**VERIFICATION CHECKLIST:**
- [ ] lsp_diagnostics on changed files - Run it yourself
- [ ] Tests pass - Run the test command yourself
- [ ] Code correct - Read the files yourself
- [ ] No regressions - Check related functionality

**REMEMBER:** Agent's "done" does NOT mean actually done.`
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
    }).trim()

    if (!output) return []

    const statusOutput = execSync("git status --porcelain", {
      cwd: directory,
      encoding: "utf-8",
      timeout: 5000,
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

interface ToolExecuteInput {
  tool: string
  sessionID?: string
  agent?: string
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

type ToolExecuteOutput = ToolExecuteAfterOutput

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent === "orchestrator-sisyphus"
}

interface SessionState {
  lastEventWasAbortError?: boolean
}

export interface SisyphusOrchestratorHookOptions {
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

export function createSisyphusOrchestratorHook(
  ctx: PluginInput,
  options?: SisyphusOrchestratorHookOptions
) {
  const backgroundManager = options?.backgroundManager
  const sessions = new Map<string, SessionState>()

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

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
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

        const mainSessionID = getMainSessionID()
        const isMainSession = sessionID === mainSessionID
        const isBackgroundTaskSession = subagentSessions.has(sessionID)

        if (mainSessionID && !isMainSession && !isBackgroundTaskSession) {
          log(`[${HOOK_NAME}] Skipped: not main or background task session`, { sessionID })
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

        const boulderState = readBoulderState(ctx.directory)
        if (!boulderState) {
          log(`[${HOOK_NAME}] No active boulder`, { sessionID })
          return
        }

        const progress = getPlanProgress(boulderState.active_plan)
        if (progress.isComplete) {
          log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
          return
        }

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

    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ): Promise<void> => {
      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      if (WRITE_EDIT_TOOLS.includes(input.tool)) {
        const filePath = output.metadata?.filePath as string | undefined
        if (filePath && !filePath.includes(ALLOWED_PATH_PREFIX)) {
          output.output = (output.output || "") + DIRECT_WORK_REMINDER
          log(`[${HOOK_NAME}] Direct work reminder appended`, {
            sessionID: input.sessionID,
            tool: input.tool,
            filePath,
          })
        }
        return
      }

      if (input.tool !== "sisyphus_task") {
        return
      }

      const outputStr = output.output && typeof output.output === "string" ? output.output : ""
      const isBackgroundLaunch = outputStr.includes("Background task launched") || outputStr.includes("Background task resumed")
      
      if (isBackgroundLaunch) {
        return
      }
      
      if (output.output && typeof output.output === "string") {
        const gitStats = getGitDiffStats(ctx.directory)
        const fileChanges = formatFileChanges(gitStats)

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

          output.output = `
## SUBAGENT WORK COMPLETED

${fileChanges}
${buildOrchestratorReminder(boulderState.plan_name, progress)}`

          log(`[${HOOK_NAME}] Output transformed for orchestrator mode (boulder)`, {
            plan: boulderState.plan_name,
            progress: `${progress.completed}/${progress.total}`,
            fileCount: gitStats.length,
          })
        } else {
          output.output += `\n${buildStandaloneVerificationReminder()}`

          log(`[${HOOK_NAME}] Verification reminder appended for orchestrator`, {
            sessionID: input.sessionID,
            fileCount: gitStats.length,
          })
        }
      }
    },
  }
}
