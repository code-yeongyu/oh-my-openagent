import type { PendingCall } from "./types"
import type { CommentCheckerConfig } from "../../config/schema"

import { initializeCommentCheckerCli, getCommentCheckerCliPathPromise, isCliPathUsable, processWithCli } from "./cli-runner"
import { registerPendingCall, startPendingCallCleanup, takePendingCall } from "./pending-calls"

import * as fs from "fs"
import { tmpdir } from "os"
import { join } from "path"

const DEBUG = process.env.COMMENT_CHECKER_DEBUG === "1"
const DEBUG_FILE = join(tmpdir(), "comment-checker-debug.log")

function debugLog(...args: unknown[]) {
  if (DEBUG) {
    const msg = `[${new Date().toISOString()}] [comment-checker:hook] ${args
      .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
      .join(" ")}\n`
    fs.appendFileSync(DEBUG_FILE, msg)
  }
}

export function createCommentCheckerHooks(config?: CommentCheckerConfig) {
  debugLog("createCommentCheckerHooks called", { config })

  startPendingCallCleanup()
  initializeCommentCheckerCli(debugLog)

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: Record<string, unknown> },
    ): Promise<void> => {
      debugLog("tool.execute.before:", {
        tool: input.tool,
        callID: input.callID,
        args: output.args,
      })

      const toolLower = input.tool.toLowerCase()
      if (toolLower !== "write" && toolLower !== "edit" && toolLower !== "multiedit") {
        debugLog("skipping non-write/edit tool:", toolLower)
        return
      }

      const filePath = (output.args.filePath ??
        output.args.file_path ??
        output.args.path) as string | undefined
      const content = output.args.content as string | undefined
      const oldString = (output.args.oldString ?? output.args.old_string) as string | undefined
      const newString = (output.args.newString ?? output.args.new_string) as string | undefined
      const edits = output.args.edits as Array<{ old_string: string; new_string: string }> | undefined

      debugLog("extracted filePath:", filePath)

      if (!filePath) {
        debugLog("no filePath found")
        return
      }

      debugLog("registering pendingCall:", {
        callID: input.callID,
        filePath,
        tool: toolLower,
      })
      registerPendingCall(input.callID, {
        filePath,
        content,
        oldString: oldString as string | undefined,
        newString: newString as string | undefined,
        edits,
        tool: toolLower as PendingCall["tool"],
        sessionID: input.sessionID,
        timestamp: Date.now(),
      })
    },

    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown },
    ): Promise<void> => {
      debugLog("tool.execute.after:", { tool: input.tool, callID: input.callID })

      const pendingCall = takePendingCall(input.callID)
      if (!pendingCall) {
        debugLog("no pendingCall found for:", input.callID)
        return
      }

      debugLog("processing pendingCall:", pendingCall)

      // Only skip if the output indicates a tool execution failure
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
        // Wait for CLI path resolution
        const cliPath = await getCommentCheckerCliPathPromise()

        if (!isCliPathUsable(cliPath)) {
          // CLI not available - silently skip comment checking
          debugLog("CLI not available, skipping comment check")
          return
        }

        // CLI mode only
        debugLog("using CLI:", cliPath)
        await processWithCli(input, pendingCall, output, cliPath, config?.custom_prompt, debugLog)
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}
