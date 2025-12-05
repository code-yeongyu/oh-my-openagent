import type { PendingCall, FileComments } from "./types"
import { runCommentChecker, isCliAvailable, type HookInput } from "./cli"
import { detectComments, isSupportedFile, warmupCommonLanguages } from "./detector"
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

// Check if native CLI is available at startup
const USE_CLI = isCliAvailable()
debugLog("comment-checker mode:", USE_CLI ? "CLI (native)" : "WASM (fallback)")

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
  
  // Background warmup for WASM fallback - LSP style (non-blocking)
  if (!USE_CLI) {
    warmupCommonLanguages()
  }
  
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
      const oldString = output.args.oldString ?? output.args.old_string as string | undefined
      const newString = output.args.newString ?? output.args.new_string as string | undefined
      const edits = output.args.edits as Array<{ old_string: string; new_string: string }> | undefined

      debugLog("extracted filePath:", filePath)

      if (!filePath) {
        debugLog("no filePath found")
        return
      }

      if (!USE_CLI && !isSupportedFile(filePath)) {
        debugLog("unsupported file:", filePath)
        return
      }

      debugLog("registering pendingCall:", { callID: input.callID, filePath, tool: toolLower })
      pendingCalls.set(input.callID, {
        filePath,
        content,
        oldString: oldString as string | undefined,
        newString: newString as string | undefined,
        edits,
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
        if (USE_CLI) {
          // Native CLI mode - much faster
          await processWithCli(input, pendingCall, output)
        } else {
          // WASM fallback mode
          await processWithWasm(pendingCall, output)
        }
      } catch (err) {
        debugLog("tool.execute.after failed:", err)
      }
    },
  }
}

async function processWithCli(
  input: { tool: string; sessionID: string; callID: string },
  pendingCall: PendingCall,
  output: { output: string }
): Promise<void> {
  debugLog("using CLI mode")
  
  const hookInput: HookInput = {
    session_id: pendingCall.sessionID,
    tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1), // "write" -> "Write"
    transcript_path: "",
    cwd: process.cwd(),
    hook_event_name: "PostToolUse",
    tool_input: {
      file_path: pendingCall.filePath,
      content: pendingCall.content,
      old_string: pendingCall.oldString,
      new_string: pendingCall.newString,
      edits: pendingCall.edits,
    },
  }
  
  const result = await runCommentChecker(hookInput)
  
  if (result.hasComments && result.message) {
    debugLog("CLI detected comments, appending message")
    output.output += `\n\n${result.message}`
  } else {
    debugLog("CLI: no comments detected")
  }
}

async function processWithWasm(
  pendingCall: PendingCall,
  output: { output: string }
): Promise<void> {
  debugLog("using WASM fallback mode")
  
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
}


