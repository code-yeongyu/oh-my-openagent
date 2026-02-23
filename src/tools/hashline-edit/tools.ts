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
            type: tool.schema
              .union([
                tool.schema.literal("set_line"),
                tool.schema.literal("replace_lines"),
                tool.schema.literal("insert_after"),
                tool.schema.literal("insert_before"),
                tool.schema.literal("insert_between"),
                tool.schema.literal("replace"),
                tool.schema.literal("append"),
                tool.schema.literal("prepend"),
              ])
              .describe("Edit operation type"),
            line: tool.schema.string().optional().describe("Anchor line in LINE#ID format"),
            start_line: tool.schema.string().optional().describe("Range start in LINE#ID format"),
            end_line: tool.schema.string().optional().describe("Range end in LINE#ID format"),
            after_line: tool.schema.string().optional().describe("Insert boundary (after) in LINE#ID format"),
            before_line: tool.schema.string().optional().describe("Insert boundary (before) in LINE#ID format"),
            text: tool.schema
              .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
              .optional()
              .describe("Operation content"),
            old_text: tool.schema.string().optional().describe("Legacy text replacement source"),
            new_text: tool.schema
              .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
              .optional()
              .describe("Legacy text replacement target"),
          })
        )
        .describe("Array of edit operations to apply (empty when delete=true)"),
    },
    execute: async (args: HashlineEditArgs, context: ToolContext) => executeHashlineEditTool(args, context),
  })
}
