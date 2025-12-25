import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV, SHELL_COMMAND_PATTERNS } from "./constants"
import { log } from "../../shared"

export * from "./constants"
export * from "./detector"
export * from "./types"

const BANNED_COMMAND_PATTERNS = SHELL_COMMAND_PATTERNS.banned
  .filter((cmd) => !cmd.includes("("))
  .map((cmd) => new RegExp(`\\b${cmd}\\b`))

function detectBannedCommand(command: string): string | undefined {
  for (let i = 0; i < BANNED_COMMAND_PATTERNS.length; i++) {
    if (BANNED_COMMAND_PATTERNS[i].test(command)) {
      return SHELL_COMMAND_PATTERNS.banned[i]
    }
  }
  return undefined
}

export function createNonInteractiveEnvHook(_ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string }
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

      const bannedCmd = detectBannedCommand(command)
      if (bannedCmd) {
        output.message = `⚠️ Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      }

      log(`[${HOOK_NAME}] Set non-interactive environment variables`, {
        sessionID: input.sessionID,
        env: NON_INTERACTIVE_ENV,
      })
    },
  }
}
