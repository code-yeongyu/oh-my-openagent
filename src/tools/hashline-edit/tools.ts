import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { executeHashlineEditTool } from "./hashline-edit-executor"
import { HASHLINE_EDIT_DESCRIPTION } from "./tool-description"
import type { RawHashlineEdit } from "./normalize-edits"

interface HashlineEditArgs {
  filePath: string
  edits: RawHashlineEdit[]
  delete?: boolean
  rename?: string
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
          tool.schema.object({
            op: tool.schema
              .union([
                tool.schema.literal("replace"),
                tool.schema.literal("append"),
                tool.schema.literal("prepend"),
              ])
              .describe("Hashline edit operation mode"),
            pos: tool.schema.string().optional().describe("Primary anchor in LINE#ID format"),
            end: tool.schema.string().optional().describe("Range end anchor in LINE#ID format"),
            lines: tool.schema
              .union([tool.schema.string(), tool.schema.array(tool.schema.string()), tool.schema.null()])
              .optional()
              .describe("Replacement or inserted lines. null/[] deletes with replace"),
          })
        )
        .describe("Array of edit operations to apply (empty when delete=true)"),
    },
    execute: async (args: HashlineEditArgs, context: ToolContext) => executeHashlineEditTool(args, context),
  })
}
