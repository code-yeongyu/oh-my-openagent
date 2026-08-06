import type { Hooks } from "@opencode-ai/plugin"

import { log } from "../shared"

const WARNING_MESSAGE = "Prefer the Read tool over `cat`/`head`/`tail` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing."

const FILE_READ_PATTERNS = [
  /^\s*cat\s+(?!-)[^\s|&;]+\s*$/,
  /^\s*head\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
  /^\s*tail\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
]

function isSimpleFileReadCommand(command: string): boolean {
  return FILE_READ_PATTERNS.some((pattern) => pattern.test(command))
}

export function createBashFileReadGuardHook(): Hooks {
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

      output.message = WARNING_MESSAGE

      log("[bash-file-read-guard] warned on bash file read command", {
        sessionID: input.sessionID,
        command,
      })
    },
  }
}
