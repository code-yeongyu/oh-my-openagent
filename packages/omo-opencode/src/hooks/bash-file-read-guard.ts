import { log } from "../shared"

export const WARNING_MESSAGE =
  "Prefer the Read tool over `cat`/`head`/`tail` for reading file contents. The Read tool provides line numbers and hash anchors for precise editing."

const FILE_READ_PATTERNS = [
  /^\s*cat\s+(?!-)[^\s|&;]+\s*$/,
  /^\s*head\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
  /^\s*tail\s+(-n\s+\d+\s+)?(?!-)[^\s|&;]+\s*$/,
]

function isSimpleFileReadCommand(command: string): boolean {
  return FILE_READ_PATTERNS.some((pattern) => pattern.test(command))
}

export function createBashFileReadGuardHook() {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string; args?: Record<string, unknown> },
      output: { title: string; output: string; metadata: Record<string, unknown> },
    ): Promise<void> => {
      if (input.tool.toLowerCase() !== "bash") {
        return
      }

      const command = input.args?.command
      if (typeof command !== "string" || !isSimpleFileReadCommand(command)) {
        return
      }

      log("[bash-file-read-guard] warned on bash file read command", {
        sessionID: input.sessionID,
        command,
      })

      if (typeof output.output === "string" && !output.output.includes(WARNING_MESSAGE)) {
        output.output = `[WARNING: ${WARNING_MESSAGE}]\n\n${output.output}`
      }
    },
  }
}
