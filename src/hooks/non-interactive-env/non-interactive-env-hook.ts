import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV, SHELL_COMMAND_PATTERNS } from "./constants"
import { log } from "../../shared"

export * from "./constants"
export * from "./detector"
export * from "./types"

const BANNED_COMMAND_PATTERNS = SHELL_COMMAND_PATTERNS.banned
  .filter((command) => !command.includes("("))
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
    "shell.env": async (
      input: { cwd: string },
      output: { env: Record<string, string> }
    ): Promise<void> => {
      for (const [key, value] of Object.entries(NON_INTERACTIVE_ENV)) {
        output.env[key] = value
      }

      log(`[${HOOK_NAME}] Injected non-interactive env vars`, {
        cwd: input.cwd,
        envCount: Object.keys(NON_INTERACTIVE_ENV).length,
      })
    },

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

      const bannedCmd = detectBannedCommand(command)
      if (bannedCmd) {
        output.message = `Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      }
    },
  }
}
