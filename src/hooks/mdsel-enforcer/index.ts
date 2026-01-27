import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync } from "fs"
import { isAbsolute, resolve } from "path"
import { HOOK_NAME, MIN_WORDS, ENFORCED_EXTENSIONS, ENFORCED_TOOLS } from "./constants"
import { log } from "../../shared/logger"

export * from "./constants"
export * from "./types"

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

interface ToolExecuteBeforeOutput {
  args: Record<string, unknown>
  message?: string
}

function getFilePath(args: Record<string, unknown>): string | undefined {
  return (args.filePath ?? args.file_path ?? args.path) as string | undefined
}

function countWords(content: string): number {
  return content.replace(/\r\n/g, "\n").split(/\s+/).filter(Boolean).length
}

function isEnforcedTool(tool: string): boolean {
  return ENFORCED_TOOLS.some(t => t.toLowerCase() === tool.toLowerCase())
}

function isEnforcedExtension(filePath: string): boolean {
  return ENFORCED_EXTENSIONS.some(ext => filePath.toLowerCase().endsWith(ext))
}

function createBlockMessage(filePath: string, wordCount: number): string {
  return `[${HOOK_NAME}] This Markdown file exceeds ${MIN_WORDS} words (${wordCount} words detected).

**You MUST use mdsel to read specific sections instead of the entire file.**

Quick start:
1. Index the document first:
   \`\`\`bash
   mdsel "${filePath}"
   \`\`\`

2. Select the section you need:
   \`\`\`bash
   mdsel h2.0 "${filePath}"
   \`\`\`

**Benefits**: ~95% token savings for targeted section reading.

**If you need the entire file**, use the Read tool with a specific reason.`
}

export function createMdselEnforcerHook(ctx: PluginInput) {
  return {
    "tool.execute.before": async (
      input: ToolExecuteInput,
      output: ToolExecuteBeforeOutput,
    ): Promise<void> => {
      const { tool, sessionID } = input

      // Only enforce on Read tool
      if (!isEnforcedTool(tool)) {
        return
      }

      // Get file path from args
      const args = output.args ?? {}
      const filePath = getFilePath(args)

      if (!filePath) {
        return
      }

      // Only enforce on .md files
      if (!isEnforcedExtension(filePath)) {
        return
      }

      // Resolve to absolute path
      const absolutePath = isAbsolute(filePath) 
        ? filePath 
        : resolve(ctx.directory, filePath)

      // Check if file exists
      if (!existsSync(absolutePath)) {
        return
      }

      // Count words
      let wordCount: number
      try {
        const content = readFileSync(absolutePath, "utf-8")
        wordCount = countWords(content)
      } catch {
        return
      }

      // If under threshold, allow
      if (wordCount <= MIN_WORDS) {
        return
      }

      // Log the enforcement
      log(`[${HOOK_NAME}] Blocking Read of large .md file`, {
        sessionID,
        filePath,
        wordCount,
        threshold: MIN_WORDS,
      })

      // Block with helpful message
      throw new Error(createBlockMessage(filePath, wordCount))
    },
  }
}
