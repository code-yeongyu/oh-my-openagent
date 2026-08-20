import type { Hooks } from "@opencode-ai/plugin"

import { log } from "../shared"

export const WARNING_MESSAGE = "Prefer the Read tool over `cat`/`head`/`tail` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing."

const FILE_READ_PATTERNS = [
  /^\s*cat\s+(?!-)[^\s|&;]+\s*$/,
  /^\s*head\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
  /^\s*tail\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
]

function isSimpleFileReadCommand(command: string): boolean {
  return FILE_READ_PATTERNS.some((pattern) => pattern.test(command))
}

export function createBashFileReadGuardHook(): Hooks {
  const pendingWarnings = new Set<string>()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown>; message?: string },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      const command = output.args.command
      if (typeof command !== "string") {
        return
      }

      if (!isSimpleFileReadCommand(command)) {
        return
      }

      pendingWarnings.add(input.callID)

      log("[bash-file-read-guard] warned on bash file read command", {
        sessionID: input.sessionID,
        command,
      })
    },
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args: Record<string, unknown> },
      output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      if (typeof output.output !== "string") {
        return
      }

      let shouldWarn = pendingWarnings.has(input.callID)
      if (shouldWarn) {
        pendingWarnings.delete(input.callID)
      } else {
        const command = (input.args as Record<string, unknown> | undefined)?.command
        if (typeof command === "string" && isSimpleFileReadCommand(command)) {
          shouldWarn = true
        }
      }

      if (!shouldWarn) {
        return
      }

      if (output.output.includes(WARNING_MESSAGE)) {
        return
      }

      output.output = `${WARNING_MESSAGE}\n\n${output.output}`

      const commandForLog = (input.args as Record<string, unknown> | undefined)?.command
      log("[bash-file-read-guard] appended warning to bash tool output", {
        sessionID: input.sessionID,
        callID: input.callID,
        command: commandForLog,
      })
    },
  }
}
