import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME, NON_INTERACTIVE_ENV, ALWAYS_BLOCK_PATTERNS, TMUX_SUGGESTION } from "./constants"
import type { BlockResult } from "./types"
import { log } from "../../shared"

export * from "./constants"
export * from "./types"

function checkTUICommand(command: string): BlockResult {
  const normalizedCmd = command.trim()

  for (const pattern of ALWAYS_BLOCK_PATTERNS) {
    if (pattern.test(normalizedCmd)) {
      return {
        blocked: true,
        reason: `Command requires full TUI`,
        command: normalizedCmd,
        matchedPattern: pattern.source,
      }
    }
  }

  return { blocked: false }
}

function wrapWithNonInteractiveEnv(command: string): string {
  const envPrefix = Object.entries(NON_INTERACTIVE_ENV)
    .map(([key, value]) => `${key}=${value}`)
    .join(" ")

  return `${envPrefix} ${command} < /dev/null 2>&1 || ${envPrefix} ${command} 2>&1`
}

export function createInteractiveBashBlockerHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase()

      if (toolLower !== "bash") {
        return
      }

      const command = output.args.command as string | undefined
      if (!command) {
        return
      }

      const result = checkTUICommand(command)

      if (result.blocked) {
        log(`[${HOOK_NAME}] Blocking TUI command`, {
          sessionID: input.sessionID,
          command: result.command,
          pattern: result.matchedPattern,
        })

        ctx.client.tui
          .showToast({
            body: {
              title: "TUI Command Blocked",
              message: `${result.reason}\nUse tmux or interactive-terminal skill instead.`,
              variant: "error",
              duration: 5000,
            },
          })
          .catch(() => {})

        throw new Error(
          `[${HOOK_NAME}] ${result.reason}\n` +
            `Command: ${result.command}\n` +
            `Pattern: ${result.matchedPattern}\n` +
            TMUX_SUGGESTION
        )
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
