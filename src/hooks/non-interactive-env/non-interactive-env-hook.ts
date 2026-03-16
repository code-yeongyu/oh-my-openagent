import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, SHELL_COMMAND_PATTERNS } from "./constants"
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

      // Only prepend env vars for git commands (editor blocking, pager, etc.)
      const isGitCommand = /\bgit\b/.test(command)
      if (!isGitCommand) {
        return
      }

      // Minimal env prefix: only the vars that prevent git from hanging.
      // Previous approach used ALL NON_INTERACTIVE_ENV vars via `export`,
      // creating a long prefix that polluted tool output and confused models
      // into echoing it back as text (#2599).
      const GIT_ENV_PREFIX = "GIT_EDITOR=: GIT_PAGER=cat GIT_TERMINAL_PROMPT=0"

      if (command.includes("GIT_EDITOR=:")) {
        return
      }

      output.args.command = `${GIT_ENV_PREFIX} ${command}`

      log(`[${HOOK_NAME}] Prepended git env vars`, {
        sessionID: input.sessionID,
      })
    },
  }
}
