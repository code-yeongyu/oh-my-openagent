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

/**
 * Shell-escape a value for use in VAR=value prefix.
 * Wraps in single quotes if contains special chars.
 */
function shellEscape(value: string): string {
  // Empty string needs quotes
  if (value === "") return "''"
  // If contains special chars, wrap in single quotes (escape existing single quotes)
  if (/[^a-zA-Z0-9_\-.:\/]/.test(value)) {
    return `'${value.replace(/'/g, "'\\''")}'`
  }
  return value
}

/**
 * Build env prefix string: VAR1=val1 VAR2=val2 ...
 * OpenCode's bash tool ignores args.env, so we must prepend to command.
 */
function buildEnvPrefix(env: Record<string, string>): string {
  return Object.entries(env)
    .map(([key, value]) => `${key}=${shellEscape(value)}`)
    .join(" ")
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
        output.message = `⚠️ Warning: '${bannedCmd}' is an interactive command that may hang in non-interactive environments.`
      }

      // Only prepend env vars for git commands (editor blocking, pager, etc.)
      const isGitCommand = /\bgit\b/.test(command)
      if (!isGitCommand) {
        return
      }

      // OpenCode's bash tool uses hardcoded `...process.env` in spawn(),
      // ignoring any args.env we might set. Prepend to command instead.
      const envPrefix = buildEnvPrefix(NON_INTERACTIVE_ENV)
      output.args.command = `${envPrefix} ${command}`

      log(`[${HOOK_NAME}] Prepended non-interactive env vars to git command`, {
        sessionID: input.sessionID,
        envPrefix,
      })
    },
  }
}
