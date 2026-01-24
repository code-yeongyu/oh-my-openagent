import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import { isAbsolute, resolve } from "path"

const DEFAULT_WORD_THRESHOLD = 200

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
  args?: Record<string, unknown>
}

function getFilePath(args: Record<string, unknown>): string | undefined {
  return (args.filePath ?? args.file_path ?? args.path) as string | undefined
}

function countWords(content: string): number {
  // Normalize line endings and count words
  return content.replace(/\r\n/g, "\n").split(/\s+/).filter(Boolean).length
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

export function createMdselReminderHook(_ctx: PluginInput) {
  const threshold = parseInt(process.env.MDSEL_MIN_WORDS || String(DEFAULT_WORD_THRESHOLD), 10)

  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput & { args?: Record<string, unknown> },
  ) => {
    const { tool } = input
    const toolLower = tool.toLowerCase()

    // Only trigger on Read tool
    if (toolLower !== "read") {
      return
    }

    // Get file path from args
    const args = output.args ?? {}
    const filePath = getFilePath(args)

    if (!filePath) {
      return
    }

    // Only process .md files
    if (!filePath.endsWith(".md")) {
      return
    }

    // Resolve full path
    const cwd = process.cwd()
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
    "tool.execute.after": toolExecuteAfter,
  }
}
