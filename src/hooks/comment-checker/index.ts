import type { PendingCall, FileComments } from "./types"
import { detectComments, isSupportedFile } from "./detector"
import { applyFilters } from "./filters"
import { formatHookMessage } from "./output"

import * as fs from "fs"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = "/tmp/comment-checker-debug.log"

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' ')}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

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
  debugLog("createCommentCheckerHooks called")
  
  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> }
    ): Promise<void> => {
      debugLog("tool.execute.before:", { tool: input.tool, callID: input.callID, args: output.args })
      
      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "write" && toolLower !== "edit" && toolLower !== "multiedit") {
        debugLog("skipping non-write/edit tool:", toolLower)
        return
      }

      const filePath = (output.args.filePath ?? output.args.file_path ?? output.args.path) as string | undefined
      const content = output.args.content as string | undefined

      debugLog("extracted filePath:", filePath)

      if (!filePath) {
        debugLog("no filePath found")
        return
      }

      if (!isSupportedFile(filePath)) {
        debugLog("unsupported file:", filePath)
        return
      }

      debugLog("registering pendingCall:", { callID: input.callID, filePath, tool: toolLower })
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
      debugLog("tool.execute.after:", { tool: input.tool, callID: input.callID })
      
      const pendingCall = pendingCalls.get(input.callID)
      if (!pendingCall) {
        debugLog("no pendingCall found for:", input.callID)
        return
      }

      pendingCalls.delete(input.callID)
      debugLog("processing pendingCall:", pendingCall)

      // Only skip if the output indicates a tool execution failure
      // (not LSP warnings/errors or other incidental "error" strings)
      const outputLower = output.output.toLowerCase()
      const isToolFailure = 
        outputLower.includes("error:") || 
        outputLower.includes("failed to") ||
        outputLower.includes("could not") ||
        outputLower.startsWith("error")
      
      if (isToolFailure) {
        debugLog("skipping due to tool failure in output")
        return
      }

      try {
        let content: string

        if (pendingCall.content) {
          content = pendingCall.content
          debugLog("using content from args")
        } else {
          debugLog("reading file:", pendingCall.filePath)
          const file = Bun.file(pendingCall.filePath)
          content = await file.text()
          debugLog("file content length:", content.length)
        }

        debugLog("calling detectComments...")
        const rawComments = await detectComments(pendingCall.filePath, content)
        debugLog("raw comments:", rawComments.length)
        
        const filteredComments = applyFilters(rawComments)
        debugLog("filtered comments:", filteredComments.length)

        if (filteredComments.length === 0) {
          debugLog("no comments after filtering")
          return
        }

        const fileComments: FileComments[] = [
          {
            filePath: pendingCall.filePath,
            comments: filteredComments,
          },
        ]

        const message = formatHookMessage(fileComments)
        debugLog("appending message to output")
        output.output += `\n\n${message}`
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}


