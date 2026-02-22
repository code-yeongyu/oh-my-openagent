import { tool, type ToolContext, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { HashlineEdit } from "./types"
import { executeHashlineEditTool } from "./hashline-edit-executor"
import { HASHLINE_EDIT_DESCRIPTION } from "./tool-description"

interface HashlineEditArgs {
  filePath: string
  edits: HashlineEdit[]
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
            tool.schema.object({
              type: tool.schema.literal("append"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Content to append at EOF; also creates missing file"),
            }),
            tool.schema.object({
              type: tool.schema.literal("prepend"),
              text: tool.schema
                .union([tool.schema.string(), tool.schema.array(tool.schema.string())])
                .describe("Content to prepend at BOF; also creates missing file"),
            }),
          ])
        )
        .describe("Array of edit operations to apply (empty when delete=true)"),
    },
    execute: async (args: HashlineEditArgs, context: ToolContext) => executeHashlineEditTool(args, context),
  })
}
