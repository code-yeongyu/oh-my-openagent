import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import { isAbsolute, resolve } from "path"

const DEFAULT_WORD_THRESHOLD = 200
const PENDING_CALL_TTL = 60_000

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
}

interface ToolExecuteAfterOutput {
  title: string
  output: string
  metadata: unknown
}

interface PendingCall {
  filePath: string
  timestamp: number
}

// Store pending calls between before and after
const pendingCalls = new Map<string, PendingCall>()

function getFilePath(args: Record<string, unknown>): string | undefined {
  return (args.filePath ?? args.file_path ?? args.path) as string | undefined
}

function countWords(content: string): number {
  // Normalize line endings and count words
  return content.replace(/\r\n/g, "\n").split(/\s+/).filter(Boolean).length
}

function cleanupOldPendingCalls(): void {
  const now = Date.now()
  for (const [callID, call] of pendingCalls) {
    if (now - call.timestamp > PENDING_CALL_TTL) {
      pendingCalls.delete(callID)
    }
  }
}

function createReminderMessage(filePath: string, wordCount: number, threshold: number): string {
  return `
[mdsel Reminder]

This Markdown file exceeds the configured size threshold (${wordCount} words > ${threshold}).
Consider using \`mdsel\` to select specific sections instead of reading the entire file.

Quick start:
1. Index: node ~/.claude/skills/mdsel/cli/dist/cli.mjs "${filePath}"
2. Select: node ~/.claude/skills/mdsel/cli/dist/cli.mjs h2.0 "${filePath}"

Benefits: ~95% token savings for targeted section reading.
`
}

let cleanupIntervalStarted = false

export function createMdselReminderHook(ctx: PluginInput) {
  const threshold = parseInt(process.env.MDSEL_MIN_WORDS || String(DEFAULT_WORD_THRESHOLD), 10)

  // Start cleanup interval once
  if (!cleanupIntervalStarted) {
    cleanupIntervalStarted = true
    setInterval(cleanupOldPendingCalls, 10_000)
  }

  const toolExecuteBefore = async (
    input: ToolExecuteInput,
    output: ToolExecuteBeforeOutput,
  ) => {
    const { tool, callID } = input
    const toolLower = tool.toLowerCase()

    // Only capture Read tool calls
    if (toolLower !== "read") {
      return
    }

    // Get file path from args
    const args = output.args ?? {}
    const filePath = getFilePath(args)

    if (!filePath) {
      return
    }

    // Only track .md files
    if (!filePath.endsWith(".md")) {
      return
    }

    // Store for later use in tool.execute.after
    pendingCalls.set(callID, {
      filePath,
      timestamp: Date.now(),
    })
  }

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteAfterOutput,
  ) => {
    const { callID } = input

    // Look up the pending call
    const pendingCall = pendingCalls.get(callID)
    if (!pendingCall) {
      return
    }

    // Clean up
    pendingCalls.delete(callID)

    const { filePath } = pendingCall

    // Resolve full path
    const cwd = ctx.directory || process.cwd()
    const fullPath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath)

    // Check if file exists
    if (!existsSync(fullPath)) {
      return
    }

    try {
      // Read and count words
      const content = readFileSync(fullPath, "utf8")
      const wordCount = countWords(content)

      // Append reminder if threshold exceeded
      if (wordCount > threshold) {
        output.output += createReminderMessage(filePath, wordCount, threshold)
      }
    } catch {
      // Graceful degradation - silently ignore errors
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
  }
}
