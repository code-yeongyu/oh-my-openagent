import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { HashlineEdit } from "./types"
import { applyHashlineEdits } from "./edit-operations"
import { computeLineHash } from "./hash-computation"

interface HashlineEditArgs {
  path: string
  edits: HashlineEdit[]
}

function generateDiff(oldContent: string, newContent: string, filePath: string): string {
  const oldLines = oldContent.split("\n")
  const newLines = newContent.split("\n")

  let diff = `--- ${filePath}\n+++ ${filePath}\n`

  const maxLines = Math.max(oldLines.length, newLines.length)
  for (let i = 0; i < maxLines; i++) {
    const oldLine = oldLines[i] ?? ""
    const newLine = newLines[i] ?? ""
    const lineNum = i + 1
    const hash = computeLineHash(lineNum, newLine)

    if (i >= oldLines.length) {
      diff += `+ ${lineNum}:${hash}|${newLine}\n`
    } else if (i >= newLines.length) {
      diff += `- ${lineNum}:  |${oldLine}\n`
    } else if (oldLine !== newLine) {
      diff += `- ${lineNum}:  |${oldLine}\n`
      diff += `+ ${lineNum}:${hash}|${newLine}\n`
    }
  }

  return diff
}

export function createHashlineEditTool(): ToolDefinition {
  return tool({
    description: `Edit files using LINE:HASH format for precise, safe modifications.

LINE:HASH FORMAT:
Each line reference must be in "LINE:HASH" format where:
- LINE: 1-based line number
- HASH: First 2 characters of xxHash32 hash of line content (computed with computeLineHash)
- Example: "5:a3|const x = 1" means line 5 with hash "a3"

GETTING HASHES:
Use the read tool - it returns lines in "LINE:HASH|content" format.

FOUR OPERATION TYPES:

1. set_line: Replace a single line
   { "type": "set_line", "line": "5:a3", "text": "const y = 2" }

2. replace_lines: Replace a range of lines
   { "type": "replace_lines", "start_line": "5:a3", "end_line": "7:b2", "text": "new\ncontent" }

3. insert_after: Insert lines after a specific line
   { "type": "insert_after", "line": "5:a3", "text": "console.log('hi')" }

4. replace: Simple text replacement (no hash validation)
   { "type": "replace", "old_text": "foo", "new_text": "bar" }

HASH MISMATCH HANDLING:
If the hash doesn't match the current content, the edit fails with a hash mismatch error. This prevents editing stale content.

BOTTOM-UP APPLICATION:
Edits are applied from bottom to top (highest line numbers first) to preserve line number references.

ESCAPING:
Use \\n in text to represent literal newlines.`,
    args: {
      path: tool.schema.string().describe("Absolute path to the file to edit"),
      edits: tool.schema
        .array(
          tool.schema.union([
            tool.schema.object({
              type: tool.schema.literal("set_line"),
              line: tool.schema.string().describe("Line reference in LINE:HASH format"),
              text: tool.schema.string().describe("New content for the line"),
            }),
            tool.schema.object({
              type: tool.schema.literal("replace_lines"),
              start_line: tool.schema.string().describe("Start line in LINE:HASH format"),
              end_line: tool.schema.string().describe("End line in LINE:HASH format"),
              text: tool.schema.string().describe("New content to replace the range"),
            }),
            tool.schema.object({
              type: tool.schema.literal("insert_after"),
              line: tool.schema.string().describe("Line reference in LINE:HASH format"),
              text: tool.schema.string().describe("Content to insert after the line"),
            }),
            tool.schema.object({
              type: tool.schema.literal("replace"),
              old_text: tool.schema.string().describe("Text to find"),
              new_text: tool.schema.string().describe("Replacement text"),
            }),
          ])
        )
        .describe("Array of edit operations to apply"),
    },
    execute: async (args: HashlineEditArgs) => {
      try {
        const { path: filePath, edits } = args

        if (!filePath) {
          return "Error: path parameter is required"
        }

        if (!edits || !Array.isArray(edits) || edits.length === 0) {
          return "Error: edits parameter must be a non-empty array"
        }

        const file = Bun.file(filePath)
        const exists = await file.exists()
        if (!exists) {
          return `Error: File not found: ${filePath}`
        }

        const oldContent = await file.text()
        const newContent = applyHashlineEdits(oldContent, edits)

        await Bun.write(filePath, newContent)

        const diff = generateDiff(oldContent, newContent, filePath)

        return `Successfully applied ${edits.length} edit(s) to ${filePath}\n\n${diff}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("hash")) {
          return `Error: Hash mismatch - ${message}`
        }
        return `Error: ${message}`
      }
    },
  })
}
