import type { PluginInput } from "@opencode-ai/plugin"
import { resolve } from "node:path"
import {
  endTaskTimer,
  getWorkForSession,
  resolveBoulderPlanPathForWork,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"
import { isOmoPath } from "./omo-path"
import { DIRECT_WORK_REMINDER } from "./system-reminder-templates"
import { parseCheckedTopLevelTaskKeys, readCheckedTaskKeysFromPlan } from "./tool-execute-after-plan-tasks"
import type { ToolExecuteAfterInput, ToolExecuteAfterOutput } from "./types"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"

export async function handleDirectWorkToolAfter(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  pendingPlanSnapshots?: Map<string, string>
  toolInput: ToolExecuteAfterInput
  toolOutput: ToolExecuteAfterOutput
}): Promise<boolean> {
  const { ctx, pendingFilePaths, pendingPlanSnapshots, toolInput, toolOutput } = input
  if (!isWriteOrEditToolName(toolInput.tool)) {
    return false
  }

  let filePath = toolInput.callID ? pendingFilePaths.get(toolInput.callID) : undefined
  const planSnapshot = toolInput.callID && pendingPlanSnapshots
    ? pendingPlanSnapshots.get(toolInput.callID)
    : undefined
  if (toolInput.callID) {
    pendingFilePaths.delete(toolInput.callID)
    pendingPlanSnapshots?.delete(toolInput.callID)
  }
  const metadataFilePath = toolOutput.metadata?.filePath
  if (!filePath && typeof metadataFilePath === "string") {
    filePath = metadataFilePath
  }

  if (filePath && toolInput.sessionID) {
    const sessionWork = getWorkForSession(ctx.directory, toolInput.sessionID)
    if (sessionWork) {
      const planPath = resolveBoulderPlanPathForWork(ctx.directory, sessionWork)
      if (resolve(filePath) === resolve(planPath) && planSnapshot !== undefined) {
        const beforeCheckedKeys = parseCheckedTopLevelTaskKeys(planSnapshot)
        const afterCheckedKeys = readCheckedTaskKeysFromPlan(planPath)
        for (const taskKey of afterCheckedKeys) {
          if (!beforeCheckedKeys.has(taskKey)) {
            endTaskTimer(ctx.directory, sessionWork.work_id, taskKey)
          }
        }
      }
    }
  }

  if (filePath && !isOmoPath(filePath)) {
    toolOutput.output = (toolOutput.output || "") + DIRECT_WORK_REMINDER
    log(`[${HOOK_NAME}] Direct work reminder appended`, {
      sessionID: toolInput.sessionID,
      tool: toolInput.tool,
      filePath,
    })
  }

  return true
}
