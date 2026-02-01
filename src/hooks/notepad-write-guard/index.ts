import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync } from "node:fs"
import { basename } from "node:path"
import { log } from "../../shared/logger"
import { HOOK_NAME, BLOCKED_MESSAGE } from "./constants"

export * from "./constants"

export function createNotepadWriteGuardHook(ctx: PluginInput) {
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

      // Check if it's a notepad file
      const fileName = basename(filePath)
      const isNotepadFile = fileName === "findings.md" || fileName === "progress.md"
      if (!isNotepadFile) {
        return
      }

      // Allow first-time creation (file doesn't exist)
      if (!existsSync(filePath)) {
        log(`[${HOOK_NAME}] Allowing first-time creation of ${fileName}`)
        return
      }

      // Block overwrite of existing file
      log(`[${HOOK_NAME}] Blocking Write on existing ${fileName}`, { filePath })
      output.blocked = true
      output.message = BLOCKED_MESSAGE
    },
  }
}
