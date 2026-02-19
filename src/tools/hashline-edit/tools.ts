import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import type { HashlineEdit } from "./types"
import { applyHashlineEdits } from "./edit-operations"
import { computeLineHash } from "./hash-computation"
import { toHashlineContent, generateUnifiedDiff, countLineDiffs } from "./diff-utils"

interface HashlineEditArgs {
  filePath: string
  edits: HashlineEdit[]
}

type ToolContextWithCallID = ToolContext & {
  callID?: string
  callId?: string
  call_id?: string
}

function resolveToolCallID(ctx: ToolContextWithCallID): string | undefined {
  if (typeof ctx.callID === "string" && ctx.callID.trim() !== "") return ctx.callID
  if (typeof ctx.callId === "string" && ctx.callId.trim() !== "") return ctx.callId
  if (typeof ctx.call_id === "string" && ctx.call_id.trim() !== "") return ctx.call_id
  return undefined
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

WORKFLOW:
1. Read the file and copy exact LINE:HASH anchors.
2. Submit one edit call with all related operations for that file.
3. If more edits are needed after success, use the latest anchors from read/edit output.
4. Use anchors as "LINE:HASH" only (never include trailing "|content").

VALIDATION:
- Payload shape: { "filePath": string, "edits": [...] }
- Each edit must be one of: set_line, replace_lines, insert_after, replace
- text/new_text must contain plain replacement text only (no LINE:HASH prefixes, no diff + markers)

LINE:HASH FORMAT (CRITICAL - READ CAREFULLY):
Each line reference must be in "LINE:HASH" format where:
- LINE: 1-based line number
- HASH: First 2 characters of xxHash32 hash of line content (hex characters 0-9, a-f only)
- Example: "5:a3" means line 5 with hash "a3"
- WRONG: "2:co" (contains non-hex 'o') - will fail!
- CORRECT: "2:e8" (hex characters only)

GETTING HASHES:
Use the read tool - it returns lines in "LINE:HASH|content" format.
Successful edit output also includes updated file content in "LINE:HASH|content" format.

FOUR OPERATION TYPES:

1. set_line: Replace a single line
   { "type": "set_line", "line": "5:a3", "text": "const y = 2" }

2. replace_lines: Replace a range of lines
   { "type": "replace_lines", "start_line": "5:a3", "end_line": "7:b2", "text": "new\\ncontent" }

3. insert_after: Insert lines after a specific line
   { "type": "insert_after", "line": "5:a3", "text": "console.log('hi')" }

4. replace: Simple text replacement (no hash validation)
   { "type": "replace", "old_text": "foo", "new_text": "bar" }

HASH MISMATCH HANDLING:
If the hash doesn't match the current content, the edit fails with a hash mismatch error. This prevents editing stale content.

SEQUENTIAL EDITS (ANTI-FLAKE):
- Always copy anchors exactly from the latest read/edit output.
- Never infer or guess hashes.
- For related edits, prefer batching them in one call.

BOTTOM-UP APPLICATION:
Edits are applied from bottom to top (highest line numbers first) to preserve line number references.

ESCAPING:
Use \\n in text to represent literal newlines.`,
    args: {
      filePath: tool.schema.string().describe("Absolute path to the file to edit"),
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
    execute: async (args: HashlineEditArgs, context: ToolContext) => {
      try {
        const filePath = args.filePath
        const { edits } = args

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
        const oldHashlined = toHashlineContent(oldContent)
        const newHashlined = toHashlineContent(newContent)

        const unifiedDiff = generateUnifiedDiff(oldContent, newContent, filePath)
        const { additions, deletions } = countLineDiffs(oldContent, newContent)

        const meta = {
          title: filePath,
          metadata: {
            filePath,
            path: filePath,
            file: filePath,
            diff: unifiedDiff,
            filediff: {
              file: filePath,
              path: filePath,
              filePath,
              before: oldHashlined,
              after: newHashlined,
              additions,
              deletions,
            },
          },
        }

        context.metadata(meta)

        const callID = resolveToolCallID(context)
        if (callID) {
          storeToolMetadata(context.sessionID, callID, meta)
        }

        return `Successfully applied ${edits.length} edit(s) to ${filePath}

${diff}

Updated file (LINE:HASH|content):
${newHashlined}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes("hash")) {
          return `Error: Hash mismatch - ${message}\nTip: reuse LINE:HASH entries from the latest read/edit output, or batch related edits in one call.`
        }
        return `Error: ${message}`
      }
    },
  })
}
