import type { PendingCall, FileComments } from "./types"
import { detectComments, isSupportedFile } from "./detector"
import { applyFilters } from "./filters"
import { formatHookMessage } from "./output"

const pendingCalls = new Map<string, PendingCall>()
const PENDING_CALL_TTL = 60_000

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
}

setInterval(cleanupOldPendingCalls, 10_000)

export function createCommentCheckerHooks() {
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "write" && toolLower !== "edit" && toolLower !== "multiedit") {
        return
      }

      const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
      const content = output.args.content as string | undefined

      if (!filePath) {
        return
      }

      if (!isSupportedFile(filePath)) {
        return
      }

      pendingCalls.set(input.callID, {
        filePath,
        content,
        tool: toolLower as "write" | "edit" | "multiedit",
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ): Promise<void> => {
      const pendingCall = pendingCalls.get(input.callID)
      if (!pendingCall) {
        return
      }

      pendingCalls.delete(input.callID)

      if (output.output.toLowerCase().includes("error")) {
        return
      }

      try {
        let content: string

        if (pendingCall.content) {
          content = pendingCall.content
        } else {
          const file = Bun.file(pendingCall.filePath)
          content = await file.text()
        }

        const rawComments = await detectComments(pendingCall.filePath, content)
        const filteredComments = applyFilters(rawComments)

        if (filteredComments.length === 0) {
          return
        }

        const fileComments: FileComments[] = [
          {
            filePath: pendingCall.filePath,
            comments: filteredComments,
          },
        ]

        const message = formatHookMessage(fileComments)
        output.output += `\n\n${message}`
      } catch {}
    },
  }
}


