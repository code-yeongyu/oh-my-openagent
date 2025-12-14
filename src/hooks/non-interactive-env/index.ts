import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NULL_DEVICE, NON_INTERACTIVE_ENV } from "./constants"
import { log } from "../../shared"

export * from "./constants"
export * from "./types"

function wrapWithNonInteractiveEnv(command: string): string {
  const envPrefix = Object.entries(NON_INTERACTIVE_ENV)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")

  return `${envPrefix} ${command} < ${NULL_DEVICE} 2>&1 || ${envPrefix} ${command} 2>&1`
}

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

      output.args.command = wrapWithNonInteractiveEnv(command)

      log(`[${HOOK_NAME}] Wrapped command with non-interactive environment`, {
        sessionID: input.sessionID,
        original: command,
        wrapped: output.args.command,
      })
    },
  }
}
