import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { log } from "../../shared/logger"
import { HOOK_NAME, PROTECTED_PATH, BLOCKED_MESSAGE } from "./constants"

export * from "./constants"

export function createObservationWriteGuardHook(ctx: PluginInput) {
  return {
    name: HOOK_NAME,
    "tool.execute.before": async (
      input: { tool: string; sessionID?: string },
      output: { args?: Record<string, unknown>; blocked?: boolean; message?: string }
    ): Promise<void> => {
      // Only intercept Write tool
      if (input.tool.toLowerCase() !== "write") {
        return
      }

      const filePath = output.args?.filePath as string | undefined
      if (!filePath) {
        return
      }

      // Check if it's in the protected observations path
      if (!filePath.includes(PROTECTED_PATH)) {
        return
      }

      // Allow first-time creation (file doesn't exist)
      if (!existsSync(filePath)) {
        log(`[${HOOK_NAME}] Allowing first-time creation of observation file`)
        return
      }

      // Block overwrite of existing file
      log(`[${HOOK_NAME}] Blocking Write on existing observation file`, { filePath })
      output.blocked = true
      output.message = BLOCKED_MESSAGE
    },
  }
}
