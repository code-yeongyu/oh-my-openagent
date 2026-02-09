import type { PendingCall } from "./types"
import { existsSync } from "fs"

import { runCommentChecker, getCommentCheckerPath, startBackgroundInit, type HookInput } from "./cli"

let cliPathPromise: Promise<string | null> | null = null

export function initializeCommentCheckerCli(debugLog: (...args: unknown[]) => void): void {
  // Start background CLI initialization (may trigger lazy download)
  startBackgroundInit()
  cliPathPromise = getCommentCheckerPath()
  cliPathPromise
    .then((path) => {
      debugLog("CLI path resolved:", path || "disabled (no binary)")
    })
    .catch((err) => {
      debugLog("CLI path resolution error:", err)
    })
}

export function getCommentCheckerCliPathPromise(): Promise<string | null> | null {
  return cliPathPromise
}

export async function processWithCli(
  input: { tool: string; sessionID: string; callID: string },
  pendingCall: PendingCall,
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  void input
  debugLog("using CLI mode with path:", cliPath)

  const hookInput: HookInput = {
    session_id: pendingCall.sessionID,
    tool_name: pendingCall.tool.charAt(0).toUpperCase() + pendingCall.tool.slice(1),
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

  const result = await runCommentChecker(hookInput, cliPath, customPrompt)

  if (result.hasComments && result.message) {
    debugLog("CLI detected comments, appending message")
    output.output += `\n\n${result.message}`
  } else {
    debugLog("CLI: no comments detected")
  }
}

export function isCliPathUsable(cliPath: string | null): cliPath is string {
  return Boolean(cliPath && existsSync(cliPath))
}
