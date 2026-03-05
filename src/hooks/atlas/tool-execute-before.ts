import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { isCallerOrchestrator } from "../../shared/session-utils"
import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME } from "./hook-name"
import { ORCHESTRATOR_DELEGATION_REQUIRED, SINGLE_TASK_DIRECTIVE } from "./system-reminder-templates"
import { isSisyphusPath } from "./sisyphus-path"
import { isWriteOrEditToolName } from "./write-edit-tool-policy"

/**
 * Check if a path is a plan file inside .sisyphus/plans/
 */
function isPlanPath(filePath: string): boolean {
  return /\.sisyphus[/\\]plans[/\\].*\.md$/.test(filePath)
}

/**
 * Transform Commit fields in plan content when autoCommit is disabled.
 * Converts "Commit: YES" and "Commit: NO" to "Commit: NO (user disabled auto-commits)"
 */
export function transformPlanCommitFields(content: string): string {
  return content.replace(/Commit:\s*(YES|NO)/g, "Commit: NO (user disabled auto-commits)")
}

export function createToolExecuteBeforeHandler(input: {
  ctx: PluginInput
  pendingFilePaths: Map<string, string>
  autoCommit: boolean
}): (
  toolInput: { tool: string; sessionID?: string; callID?: string },
  toolOutput: { args: Record<string, unknown>; message?: string }
) => Promise<void> {
  const { ctx, pendingFilePaths, autoCommit } = input

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
      const prompt = toolOutput.args.prompt as string | undefined
      if (prompt && !prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
        toolOutput.args.prompt = `<system-reminder>${SINGLE_TASK_DIRECTIVE}</system-reminder>\n` + prompt
        log(`[${HOOK_NAME}] Injected single-task directive to task`, {
          sessionID: toolInput.sessionID,
        })
      }
      return
    }

    // Transform plan content when autoCommit is disabled
    if (!autoCommit && toolInput.tool === "read") {
      const filePath = toolOutput.args.filePath as string | undefined
      if (filePath && isPlanPath(filePath)) {
        const content = toolOutput.args.content as string | undefined
        if (content) {
          toolOutput.args.content = transformPlanCommitFields(content)
          log(`[${HOOK_NAME}] Transformed plan Commit fields for read`, {
            sessionID: toolInput.sessionID,
            filePath,
          })
        }
      }
    }
  }
}
