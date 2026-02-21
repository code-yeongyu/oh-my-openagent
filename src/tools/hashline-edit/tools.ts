import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import type { HashlineEdit } from "./types"
import { applyHashlineEditsWithReport } from "./edit-operations"
import { computeLineHash } from "./hash-computation"
import { toHashlineContent, generateUnifiedDiff, countLineDiffs } from "./diff-utils"
import { HASHLINE_EDIT_DESCRIPTION } from "./tool-description"

interface HashlineEditArgs {
  filePath: string
  edits: HashlineEdit[]
  delete?: boolean
  rename?: string
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
    description: HASHLINE_EDIT_DESCRIPTION,
    args: {
      filePath: tool.schema.string().describe("Absolute path to the file to edit"),
      delete: tool.schema.boolean().optional().describe("Delete file instead of editing"),
      rename: tool.schema.string().optional().describe("Rename output file path after edits"),
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
              type: tool.schema.literal("insert_before"),
              line: tool.schema.string().describe("Line reference in LINE#ID format"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Content to insert before the line (string or string[] for multiline)"),
            }),
            tool.schema.object({
              type: tool.schema.literal("insert_between"),
              after_line: tool.schema.string().describe("After line in LINE#ID format"),
              before_line: tool.schema.string().describe("Before line in LINE#ID format"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Content to insert between anchor lines (string or string[] for multiline)"),
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
        .describe("Array of edit operations to apply (empty when delete=true)"),
    },
    execute: async (args: HashlineEditArgs, context: ToolContext) => {
      try {
        const metadataContext = context as ToolContextWithMetadata
        const filePath = args.filePath
        const { edits, delete: deleteMode, rename } = args

        if (deleteMode && rename) {
          return "Error: delete and rename cannot be used together"
        }

        if (!deleteMode && (!edits || !Array.isArray(edits) || edits.length === 0)) {
          return "Error: edits parameter must be a non-empty array"
        }
        if (deleteMode && edits.length > 0) {
          return "Error: delete mode requires edits to be an empty array"
        }

        const file = Bun.file(filePath)
        const exists = await file.exists()
        if (!exists) {
          return `Error: File not found: ${filePath}`
        }

        if (deleteMode) {
          await Bun.file(filePath).delete()
          return `Successfully deleted ${filePath}`
        }

        const oldContent = await file.text()
        const applyResult = applyHashlineEditsWithReport(oldContent, edits)
        const newContent = applyResult.content

        await Bun.write(filePath, newContent)

        if (rename && rename !== filePath) {
          await Bun.write(rename, newContent)
          await Bun.file(filePath).delete()
        }

        const effectivePath = rename && rename !== filePath ? rename : filePath

        const diff = generateDiff(oldContent, newContent, effectivePath)
        const newHashlined = toHashlineContent(newContent)

        const unifiedDiff = generateUnifiedDiff(oldContent, newContent, effectivePath)
        const { additions, deletions } = countLineDiffs(oldContent, newContent)

        const meta = {
          title: effectivePath,
          metadata: {
            filePath: effectivePath,
            path: effectivePath,
            file: effectivePath,
            diff: unifiedDiff,
            noopEdits: applyResult.noopEdits,
            deduplicatedEdits: applyResult.deduplicatedEdits,
            filediff: {
              file: effectivePath,
              path: effectivePath,
              filePath: effectivePath,
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

        return `Successfully applied ${edits.length} edit(s) to ${effectivePath}
No-op edits: ${applyResult.noopEdits}, deduplicated edits: ${applyResult.deduplicatedEdits}

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
