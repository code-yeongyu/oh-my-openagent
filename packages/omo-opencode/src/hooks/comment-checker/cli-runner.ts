import type { PendingCall } from "./types"
import { existsSync } from "fs"

import { runCommentChecker, getCommentCheckerPath, startBackgroundInit, type HookInput } from "./cli"

let cliPathPromise: Promise<string | null> | null = null
let isRunning = false

/** Per-session deduplication: track last warning time to prevent deadloop */
const sessionLastWarning = new Map<string, number>()
const DEDUP_WINDOW_MS = 30_000 // 30 seconds — fire at most once per response turn

/** Detect whether a comment string looks like a line-comment or block-comment pattern */
function hasCommentSyntax(text: string | undefined): boolean {
  if (!text) return false
  return /^\s*(\/\/|\/\*|#|--|<!--|:\s*)[\s\S]*$/m.test(text) || /<!--[\s\S]*-->/.test(text)
}

/**
 * Returns true if any lines in `newText` contain comments that did NOT exist in
 * `oldText`. This filters out false positives when oldString/newString both
 * contain the same existing comment that was only slightly modified.
 */
function hasNewCommentsOnly(oldText: string | undefined, newText: string | undefined): boolean {
  if (!hasCommentSyntax(newText)) return false
  // If there was no old text, any comment is by definition new
  if (!hasCommentSyntax(oldText)) return true
  // Both contain comments — do a rough line-level diff to see if new comment
  // lines were added (not just modified in-place)
  const oldLines = new Set((oldText ?? "").split("\n").map((l) => l.trim()))
  const newLines = (newText ?? "").split("\n")
  return newLines.some((l) => {
    const trimmed = l.trim()
    return trimmed && hasCommentSyntax(trimmed) && !oldLines.has(trimmed)
  })
}

async function withCommentCheckerLock<T>(
  fn: () => Promise<T>,
  fallback: T,
  debugLog: (...args: unknown[]) => void,
): Promise<T> {
  if (isRunning) {
    debugLog("comment-checker already running, skipping")
    return fallback
  }
  isRunning = true
  try {
    return await fn()
  } finally {
    isRunning = false
  }
}

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
  deps: {
    runCommentChecker?: typeof runCommentChecker
  } = {},
): Promise<void> {
  await withCommentCheckerLock(async () => {
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

    // --- Fix #4292 Issue 1: skip if comment was already in oldString ---
    if (!hasNewCommentsOnly(pendingCall.oldString, pendingCall.newString)) {
      debugLog("skipping: no net-new comments in edit (oldString/newString)")
      return
    }

    // --- Fix #4292 Issue 2: deduplicate per-session (at most once per 30s) ---
    const lastWarned = sessionLastWarning.get(pendingCall.sessionID) ?? 0
    const now = Date.now()
    if (now - lastWarned < DEDUP_WINDOW_MS) {
      debugLog("dedup: skipping comment warning within dedup window for session", pendingCall.sessionID)
      return
    }
    sessionLastWarning.set(pendingCall.sessionID, now)

    const result = await (deps.runCommentChecker ?? runCommentChecker)(hookInput, cliPath, customPrompt)

    if (result.hasComments && result.message) {
      debugLog("CLI detected comments, appending message")
      output.output += `\n\n${result.message}`
    } else {
      debugLog("CLI: no comments detected")
    }
  }, undefined, debugLog)
}

export interface ApplyPatchEdit {
  filePath: string
  before: string
  after: string
}

export async function processApplyPatchEditsWithCli(
  sessionID: string,
  edits: ApplyPatchEdit[],
  output: { output: string },
  cliPath: string,
  customPrompt: string | undefined,
  debugLog: (...args: unknown[]) => void,
): Promise<void> {
  debugLog("processing apply_patch edits:", edits.length)

  for (const edit of edits) {
    await withCommentCheckerLock(async () => {
      const hookInput: HookInput = {
        session_id: sessionID,
        tool_name: "Edit",
        transcript_path: "",
        cwd: process.cwd(),
        hook_event_name: "PostToolUse",
        tool_input: {
          file_path: edit.filePath,
          old_string: edit.before,
          new_string: edit.after,
        },
      }

      const result = await runCommentChecker(hookInput, cliPath, customPrompt)

      if (result.hasComments && result.message) {
        debugLog("CLI detected comments for apply_patch file:", edit.filePath)
        output.output += `\n\n${result.message}`
      }
    }, undefined, debugLog)
  }
}

export function isCliPathUsable(cliPath: string | null): cliPath is string {
  return Boolean(cliPath && existsSync(cliPath))
}
