import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV } from "./constants"
import { log } from "../../shared"

export * from "./constants"
export * from "./types"

export function createNonInteractiveEnvHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      const command = output.args.command as string | undefined
      if (!command) {
        return
      }

      output.args.env = {
        ...(output.args.env as Record<string, string> | undefined),
        ...NON_INTERACTIVE_ENV,
      }

      log(`[${HOOK_NAME}] Set non-interactive environment variables`, {
        sessionID: input.sessionID,
        env: NON_INTERACTIVE_ENV,
      })
    },
  }
}
