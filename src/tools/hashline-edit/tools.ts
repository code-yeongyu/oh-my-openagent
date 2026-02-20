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

type ToolContextWithMetadata = ToolContextWithCallID & {
  metadata?: (value: unknown) => void
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
      diff += `+ ${lineNum}#${hash}:${newLine}\n`
    } else if (i >= newLines.length) {
      diff += `- ${lineNum}#  :${oldLine}\n`
    } else if (oldLine !== newLine) {
      diff += `- ${lineNum}#  :${oldLine}\n`
      diff += `+ ${lineNum}#${hash}:${newLine}\n`
    }
  }

  return diff
}

export function createHashlineEditTool(): ToolDefinition {
  return tool({
    description: `Edit files using LINE#ID format for precise, safe modifications.

WORKFLOW:
1. Read the file and copy exact LINE#ID anchors.
2. Submit one edit call with all related operations for that file.
3. If more edits are needed after success, use the latest anchors from read/edit output.
4. Use anchors as "LINE#ID" only (never include trailing ":content").

VALIDATION:
- Payload shape: { "filePath": string, "edits": [...] }
- Each edit must be one of: set_line, replace_lines, insert_after, replace
- text/new_text must contain plain replacement text only (no LINE#ID prefixes, no diff + markers)

LINE#ID FORMAT (CRITICAL - READ CAREFULLY):
Each line reference must be in "LINE#ID" format where:
- LINE: 1-based line number
- ID: Two CID letters from the set ZPMQVRWSNKTXJBYH
- Example: "5#VK" means line 5 with hash id "VK"
- WRONG: "2#aa" (invalid characters) - will fail!
- CORRECT: "2#VK"

GETTING HASHES:
Use the read tool - it returns lines in "LINE#ID:content" format.
Successful edit output also includes updated file content in "LINE#ID:content" format.

FOUR OPERATION TYPES:

1. set_line: Replace a single line
   { "type": "set_line", "line": "5#VK", "text": "const y = 2" }

2. replace_lines: Replace a range of lines
   { "type": "replace_lines", "start_line": "5#VK", "end_line": "7#NP", "text": ["new", "content"] }

3. insert_after: Insert lines after a specific line
   { "type": "insert_after", "line": "5#VK", "text": "console.log('hi')" }

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

CONTENT FORMAT:
- text/new_text can be a string (single line) or string[] (multi-line, preferred).
- If you pass a multi-line string, it is split by real newline characters.
- Literal "\\n" is preserved as text.`,
    args: {
      filePath: tool.schema.string().describe("Absolute path to the file to edit"),
      edits: tool.schema
        .array(
          tool.schema.union([
            tool.schema.object({
              type: tool.schema.literal("set_line"),
              line: tool.schema.string().describe("Line reference in LINE#ID format"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("New content for the line (string or string[] for multiline)"),
            }),
            tool.schema.object({
              type: tool.schema.literal("replace_lines"),
              start_line: tool.schema.string().describe("Start line in LINE#ID format"),
              end_line: tool.schema.string().describe("End line in LINE#ID format"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("New content to replace the range (string or string[] for multiline)"),
            }),
            tool.schema.object({
              type: tool.schema.literal("insert_after"),
              line: tool.schema.string().describe("Line reference in LINE#ID format"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Content to insert after the line (string or string[] for multiline)"),
            }),
            tool.schema.object({
              type: tool.schema.literal("replace"),
              old_text: tool.schema.string().describe("Text to find"),
              new_text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Replacement text (string or string[] for multiline)"),
            }),
          ])
        )
        .describe("Array of edit operations to apply"),
    },
    execute: async (args: HashlineEditArgs, context: ToolContext) => {
      try {
        const metadataContext = context as ToolContextWithMetadata
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
              before: oldContent,
              after: newContent,
              additions,
              deletions,
            },
          },
        }

        if (typeof metadataContext.metadata === "function") {
          metadataContext.metadata(meta)
        }

        const callID = resolveToolCallID(metadataContext)
        if (callID) {
          storeToolMetadata(context.sessionID, callID, meta)
        }

        return `Successfully applied ${edits.length} edit(s) to ${filePath}

${diff}

Updated file (LINE#ID:content):
${newHashlined}`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.toLowerCase().includes("hash")) {
          return `Error: hash mismatch - ${message}\nTip: reuse LINE#ID entries from the latest read/edit output, or batch related edits in one call.`
        }
        return `Error: ${message}`
      }
    },
  })
}
