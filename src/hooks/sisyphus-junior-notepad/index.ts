import type { PluginInput } from "@opencode-ai/plugin"
import { isCallerOrchestrator } from "../../shared/session-utils"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { log } from "../../shared/logger"
import { HOOK_NAME, NOTEPAD_DIRECTIVE } from "./constants"

export * from "./constants"

export function createSisyphusJuniorNotepadHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
    ): Promise<void> => {
      // 1. Check if tool is delegate_task
      if (input.tool !== "delegate_task") {
        return
      }

      // 2. Check if caller is Atlas (orchestrator)
      if (!isCallerOrchestrator(input.sessionID)) {
        return
      }

      // 3. Get prompt from output.args
      const prompt = output.args.prompt as string | undefined
      if (!prompt) {
        return
      }

      // 4. Check for double injection
      if (prompt.includes(SYSTEM_DIRECTIVE_PREFIX)) {
        return
      }

      // 5. Prepend directive
      output.args.prompt = NOTEPAD_DIRECTIVE + prompt

      // 6. Log injection
      log(`[${HOOK_NAME}] Injected notepad directive to delegate_task`, {
        sessionID: input.sessionID,
      })
    },
  }
}
