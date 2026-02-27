import type { PluginInput } from "@opencode-ai/plugin"
import { execSync } from "node:child_process"
import {
  appendSessionId,
  getFirstIncompleteTask,
  getPlanProgress,
  incrementRetry,
  isMaxRetries,
  readBoulderState,
  resetRetry,
  updatePhaseStatus,
  type BoulderState,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { isBlockedResponse } from "../../shared/blocked-task-detector"
import { isCallerOrchestrator } from "../../shared/session-utils"
import {
  buildOrchestratorReminder,
  buildStandaloneVerificationReminder,
  DIRECT_WORK_REMINDER,
} from "./system-reminder-templates"

export interface ToolExecuteAfterInput {
  tool: string
  sessionID?: string
  callID?: string
}

export interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: Record<string, unknown>
}

interface CreateToolExecuteAfterHandlerOptions {
  ctx: PluginInput
  hookName: string
  pendingFilePaths: Map<string, string>
  isSisyphusPath: (filePath: string) => boolean
  writeEditTools: string[]
}

interface BlockedResponseDetectionOptions {
  ctx: PluginInput
  sessionID: string
  boulderState: BoulderState
  hookName: string
}

interface GitFileStat {
  path: string
  added: number
  removed: number
  status: "modified" | "added" | "deleted"
}

function extractSessionIdFromOutput(output: string): string {
  const match = output.match(/Session ID:\s*(ses_[a-zA-Z0-9]+)/)
  return match?.[1] ?? "<session_id>"
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

export async function detectBlockedResponse({
  ctx,
  sessionID,
  boulderState,
  hookName,
}: BlockedResponseDetectionOptions): Promise<boolean> {
  try {
    const messagesResp = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    })
    const messages = (messagesResp as {
      data?: Array<{ info?: { role?: string }; parts?: Array<{ type: string; text?: string }> }>
    }).data ?? []

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.info?.role === "assistant" && msg.parts) {
        const assistantContent = msg.parts
          .filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join(" ")

        const currentTask = getFirstIncompleteTask(boulderState.active_plan)
        const taskId = currentTask
          ? `${boulderState.plan_name}::${currentTask}`
          : boulderState.plan_name

        if (isBlockedResponse(assistantContent)) {
          const retryCount = incrementRetry(ctx.directory, taskId, assistantContent.slice(0, 200))

          if (isMaxRetries(ctx.directory, taskId)) {
            updatePhaseStatus(ctx.directory, "blocked")
            log(`[${hookName}] Task blocked after ${retryCount} retries`, {
              sessionID,
              plan: boulderState.plan_name,
              task: currentTask,
              preview: assistantContent.slice(0, 100),
            })
            return true
          }

          log(`[${hookName}] Blocked response detected, retry ${retryCount}/3`, {
            sessionID,
            plan: boulderState.plan_name,
            task: currentTask,
            preview: assistantContent.slice(0, 100),
          })
        } else {
          resetRetry(ctx.directory, taskId)
        }

        break
      }
    }
  } catch (err) {
    log(`[${hookName}] Failed to check for blocked response`, { sessionID, error: String(err) })
  }

  return false
}

export function createToolExecuteAfterHandler(options: CreateToolExecuteAfterHandlerOptions) {
  const { ctx, hookName, pendingFilePaths, isSisyphusPath, writeEditTools } = options

  return async (
    input: ToolExecuteAfterInput,
    output: ToolExecuteAfterOutput | undefined
  ): Promise<void> => {
    // Guard against undefined output (e.g., from /review command - see issue #1035)
    if (output === undefined) {
      return
    }

    // Track skill calls for phase updates (Task 13)
    if (input.tool === "skill") {
      const skillName = (output.metadata?.name ?? output.metadata?.skillName ?? "") as string
      const skillNameLower = skillName.toLowerCase()

      try {
        if (skillNameLower.includes("brainstorming")) {
          updatePhaseStatus(ctx.directory, "planning")
          log(`[${hookName}] Skill phase tracking: brainstorming → planning`, { sessionID: input.sessionID })
        } else if (
          skillNameLower.includes("executing-plans") ||
          skillNameLower.includes("wave-parallel")
        ) {
          updatePhaseStatus(ctx.directory, "executing")
          log(`[${hookName}] Skill phase tracking: execution skill → executing`, {
            sessionID: input.sessionID,
          })
        } else if (skillNameLower.includes("finishing-a-development-branch")) {
          updatePhaseStatus(ctx.directory, "awaiting_user")
          log(`[${hookName}] Skill phase tracking: finishing → awaiting_user`, {
            sessionID: input.sessionID,
          })
        } else if (skillNameLower.includes("archiving-changes")) {
          updatePhaseStatus(ctx.directory, "completed")
          log(`[${hookName}] Skill phase tracking: archiving → completed`, {
            sessionID: input.sessionID,
          })
        }
      } catch (err) {
        log(`[${hookName}] Skill phase tracking failed`, {
          sessionID: input.sessionID,
          skill: skillName,
          error: String(err),
        })
      }
    }

    if (!isCallerOrchestrator(input.sessionID)) {
      return
    }

    if (writeEditTools.includes(input.tool)) {
      let filePath = input.callID ? pendingFilePaths.get(input.callID) : undefined
      if (input.callID) {
        pendingFilePaths.delete(input.callID)
      }
      if (!filePath) {
        filePath = output.metadata?.filePath as string | undefined
      }
      if (filePath && !isSisyphusPath(filePath)) {
        output.output = (output.output || "") + DIRECT_WORK_REMINDER
        log(`[${hookName}] Direct work reminder appended`, {
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
    const isBackgroundLaunch =
      outputStr.includes("Background task launched") || outputStr.includes("Background task continued")

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
          log(`[${hookName}] Appended session to boulder`, {
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

        log(`[${hookName}] Output transformed for orchestrator mode (boulder)`, {
          plan: boulderState.plan_name,
          progress: `${progress.completed}/${progress.total}`,
          fileCount: gitStats.length,
        })
      } else {
        output.output += `\n<system-reminder>\n${buildStandaloneVerificationReminder(subagentSessionId)}\n</system-reminder>`

        log(`[${hookName}] Verification reminder appended for orchestrator`, {
          sessionID: input.sessionID,
          fileCount: gitStats.length,
        })
      }
    }
  }
}
