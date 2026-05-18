import { log } from "../../shared/logger"
import { replaceToolArgs } from "../../shared/replace-tool-args"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { isCallerOrchestrator } from "../../shared/session-utils"
import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { getWorkForSession, readBoulderState, readCurrentTopLevelTask, resolveBoulderPlanPath, resolveBoulderPlanPathForWork } from "../../features/boulder-state"
import { HOOK_NAME } from "./hook-name"
import { ORCHESTRATOR_DELEGATION_REQUIRED, SINGLE_TASK_DIRECTIVE } from "./system-reminder-templates"
import { isOmoPath } from "./omo-path"
import type { PendingTaskRef, TrackedTopLevelTaskRef } from "./types"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"

const TASK_SECTION_HEADER_PATTERN = /^##\s*1\.\s*TASK\s*$/i
const TODO_TASK_LINE_PATTERN = /^(?:[-*]\s*\[\s*\]\s*)?(\d+)\.\s+(.+)$/
const FINAL_WAVE_TASK_LINE_PATTERN = /^(?:[-*]\s*\[\s*\]\s*)?(F\d+)\.\s+(.+)$/i

function parseTrackedTaskFromPrompt(prompt: string): TrackedTopLevelTaskRef | null {
  const lines = prompt.split(/\r?\n/)
  const taskHeaderIndex = lines.findIndex((line) => TASK_SECTION_HEADER_PATTERN.test(line.trim()))
  if (taskHeaderIndex < 0) {
    return null
  }

  const startIndex = taskHeaderIndex + 1
  const endIndex = Math.min(lines.length, startIndex + 5)
  for (let index = startIndex; index < endIndex; index += 1) {
    const candidate = lines[index]?.trim()
    if (!candidate) {
      continue
    }

    const finalWaveMatch = candidate.match(FINAL_WAVE_TASK_LINE_PATTERN)
    if (finalWaveMatch?.[1] && finalWaveMatch[2]) {
      const label = finalWaveMatch[1].toUpperCase()
      return {
        key: `final-wave:${label.toLowerCase()}`,
        label,
        title: finalWaveMatch[2].trim(),
      }
    }

    const todoMatch = candidate.match(TODO_TASK_LINE_PATTERN)
    if (todoMatch?.[1] && todoMatch[2]) {
      const label = todoMatch[1]
      return {
        key: `todo:${label}`,
        label,
        title: todoMatch[2].trim(),
      }
    }
  }

  return null
}

export function createToolExecuteBeforeHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingTaskRefs: Map<string, PendingTaskRef>
  pendingPlanSnapshots?: Map<string, string>
  isCallerOrchestrator?: (sessionID: string | undefined) => Promise<boolean>
}): (
  toolInput: { tool: string; sessionID?: string; callID?: string },
  toolOutput: { args: Record<string, unknown>; message?: string }
) => Promise<void> {
  const { ctx, pendingFilePaths, pendingTaskRefs, pendingPlanSnapshots } = input
  const resolveIsCallerOrchestrator = input.isCallerOrchestrator ?? ((sessionID) => isCallerOrchestrator(sessionID, ctx.client))

  function trackTask(callID: string, task: TrackedTopLevelTaskRef): void {
    pendingTaskRefs.set(callID, { kind: "track", task })
  }

  return async (toolInput, toolOutput): Promise<void> => {
    if (!(await resolveIsCallerOrchestrator(toolInput.sessionID))) {
      return
    }

    // Check Write/Edit tools for orchestrator - inject strong warning
    // Warn-only policy: Atlas guides orchestrators toward delegation but doesn't block, allowing flexibility for urgent fixes
    if (isWriteOrEditToolName(toolInput.tool)) {
      const filePath = (toolOutput.args.filePath ?? toolOutput.args.path ?? toolOutput.args.file) as string | undefined
      if (!filePath || !toolInput.callID) {
        return
      }

      // Store filePath for use in tool.execute.after
      pendingFilePaths.set(toolInput.callID, filePath)

      const sessionID = toolInput.sessionID
      const sessionWork = sessionID
        ? getWorkForSession(ctx.directory, sessionID)
        : null
      const state = sessionWork ? null : readBoulderState(ctx.directory)
      const planPath = sessionWork
        ? resolveBoulderPlanPathForWork(ctx.directory, sessionWork)
        : state
          ? resolveBoulderPlanPath(ctx.directory, state)
          : null

      if (planPath && resolve(filePath) === resolve(planPath) && pendingPlanSnapshots) {
        try {
          if (existsSync(planPath)) {
            pendingPlanSnapshots.set(toolInput.callID, readFileSync(planPath, "utf-8"))
          }
        } catch {
          pendingPlanSnapshots.delete(toolInput.callID)
        }
      }

      if (!isOmoPath(filePath)) {
        const warning = ORCHESTRATOR_DELEGATION_REQUIRED.replace("$FILE_PATH", filePath)
        toolOutput.message = (toolOutput.message || "") + warning
        log(`[${HOOK_NAME}] Injected delegation warning for direct file modification`, {
          sessionID: toolInput.sessionID,
          tool: toolInput.tool,
          filePath,
        })
      }
      return
    }

    // Check task - inject single-task directive
    if (toolInput.tool === "task") {
      if (toolInput.callID) {
        const requestedSessionId = toolOutput.args.session_id as string | undefined
        if (requestedSessionId) {
          pendingTaskRefs.set(toolInput.callID, {
            kind: "skip",
            reason: "explicit_resume",
          })
        } else {
          const prompt = typeof toolOutput.args.prompt === "string" ? toolOutput.args.prompt : ""
          const taskFromPrompt = parseTrackedTaskFromPrompt(prompt)
          const boulderState = readBoulderState(ctx.directory)
          const currentTask = boulderState
            ? readCurrentTopLevelTask(resolveBoulderPlanPath(ctx.directory, boulderState))
            : null
          const resolvedTask = taskFromPrompt ?? (currentTask
            ? {
                key: currentTask.key,
                label: currentTask.label,
                title: currentTask.title,
              }
            : null)
          if (resolvedTask) {
            if (!taskFromPrompt) {
              log(`[${HOOK_NAME}] TASK section parse failed; falling back to current top-level task`, {
                sessionID: toolInput.sessionID,
                callID: toolInput.callID,
              })
            }
            const trackedTask = {
              key: resolvedTask.key,
              label: resolvedTask.label,
              title: resolvedTask.title,
            }
            const hasExistingClaim = [...pendingTaskRefs.values()].some((pendingTaskRef) => (
              pendingTaskRef.kind === "track" && pendingTaskRef.task.key === trackedTask.key
            ))

            if (hasExistingClaim) {
              pendingTaskRefs.set(toolInput.callID, {
                kind: "skip",
                reason: "ambiguous_task_key",
                task: trackedTask,
              })
              log(`[${HOOK_NAME}] Skipping task session persistence for ambiguous task key`, {
                sessionID: toolInput.sessionID,
                callID: toolInput.callID,
                taskKey: trackedTask.key,
              })
            } else {
              trackTask(toolInput.callID, trackedTask)
            }
          }
        }
      }

      const prompt = toolOutput.args.prompt as string | undefined
      if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
        replaceToolArgs(toolOutput, { prompt: `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n` + prompt })
        log(`[${HOOK_NAME}] Injected single-task directive to task`, {
          sessionID: toolInput.sessionID,
        })
      }
    }
  }
}
