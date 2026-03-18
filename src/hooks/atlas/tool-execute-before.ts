import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { isCallerOrchestrator } from "../../shared/session-utils"
import type { PluginInput } from "@opencode-ai/plugin"
import { readBoulderState, readCurrentTopLevelTask } from "../../features/boulder-state"
import { HOOK_NAME } from "./hook-name"
import { ORCHESTRATOR_DELEGATION_REQUIRED, SINGLE_TASK_DIRECTIVE } from "./system-reminder-templates"
import { isSisyphusPath } from "./sisyphus-path"
import type { PendingTaskRef, TrackedTopLevelTaskRef } from "./types"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"

export function createToolExecuteBeforeHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingTaskRefs: Map<string, PendingTaskRef>
}): (
  toolInput: { tool: string; sessionID?: string; callID?: string },
  toolOutput: { args: Record<string, unknown>; message?: string }
) => Promise<void> {
  const { ctx, pendingFilePaths, pendingTaskRefs } = input

  function trackTask(callID: string, task: TrackedTopLevelTaskRef): void {
    pendingTaskRefs.set(callID, { kind: "track", task })
  }

  return async (toolInput, toolOutput): Promise<void> => {
    if (!(await isCallerOrchestrator(toolInput.sessionID, ctx.client))) {
      return
    }

    // Check Write/Edit tools for orchestrator - inject strong warning
    // Warn-only policy: Atlas guides orchestrators toward delegation but doesn't block, allowing flexibility for urgent fixes
    if (isWriteOrEditToolName(toolInput.tool)) {
      const filePath = (toolOutput.args.filePath ?? toolOutput.args.path ?? toolOutput.args.file) as string | undefined
      if (filePath && !isSisyphusPath(filePath)) {
        // Store filePath for use in tool.execute.after
        if (toolInput.callID) {
          pendingFilePaths.set(toolInput.callID, filePath)
        }
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
          const boulderState = readBoulderState(ctx.directory)
          const currentTask = boulderState
            ? readCurrentTopLevelTask(boulderState.active_plan)
            : null
          if (currentTask) {
            const task = {
              key: currentTask.key,
              label: currentTask.label,
              title: currentTask.title,
            }
            const hasExistingClaim = [...pendingTaskRefs.values()].some((pendingTaskRef) => (
              pendingTaskRef.kind === "track" && pendingTaskRef.task.key === task.key
            ))

            if (hasExistingClaim) {
              pendingTaskRefs.set(toolInput.callID, {
                kind: "skip",
                reason: "ambiguous_task_key",
                task,
              })
              log(`[${HOOK_NAME}] Skipping task session persistence for ambiguous task key`, {
                sessionID: toolInput.sessionID,
                callID: toolInput.callID,
                taskKey: task.key,
              })
            } else {
              trackTask(toolInput.callID, task)
            }
          }
        }
      }

      const prompt = toolOutput.args.prompt as string | undefined
      if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
        toolOutput.args.prompt = `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n` + prompt
        log(`[${HOOK_NAME}] Injected single-task directive to task`, {
          sessionID: toolInput.sessionID,
        })
      }
    }
  }
}
