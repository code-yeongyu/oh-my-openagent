import type { PluginInput } from "@opencode-ai/plugin"
import {
  HOOK_NAME,
  INTERACTIVE_FLAG_PATTERNS,
  STDIN_REQUIRING_COMMANDS,
  TMUX_SUGGESTION,
} from "./constants"
import type { BlockResult } from "./types"
import { log } from "../../shared"

export * from "./constants"
export * from "./types"

function checkInteractiveCommand(command: string): BlockResult {
  const normalizedCmd = command.trim()

  for (const pattern of INTERACTIVE_FLAG_PATTERNS) {
    if (pattern.test(normalizedCmd)) {
      return {
        blocked: true,
        reason: `Command contains interactive pattern`,
        command: normalizedCmd,
        matchedPattern: pattern.source,
      }
    }
  }

  for (const cmd of STDIN_REQUIRING_COMMANDS) {
    if (normalizedCmd.includes(cmd)) {
      return {
        blocked: true,
        reason: `Command requires stdin interaction: ${cmd}`,
        command: normalizedCmd,
        matchedPattern: cmd,
      }
    }
  }

  return { blocked: false }
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

      const result = checkInteractiveCommand(command)

      if (result.blocked) {
        log(`[${HOOK_NAME}] Blocking interactive command`, {
          sessionID: input.sessionID,
          command: result.command,
          pattern: result.matchedPattern,
        })

        ctx.client.tui
          .showToast({
            body: {
              title: "Interactive Command Blocked",
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
    },
  }
}
