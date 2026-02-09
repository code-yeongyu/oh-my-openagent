import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"

import { DEFAULT_MAX_REFERENCES } from "./constants"
import { formatLocation } from "./lsp-formatters"
import { withLspClient } from "./lsp-client-wrapper"
import type { Location } from "./types"

export const lsp_find_references: ToolDefinition = tool({
  description: "Find ALL usages/references of a symbol across the entire workspace.",
  args: {
    filePath: tool.schema.string(),
    line: tool.schema.number().min(1).describe("1-based"),
    character: tool.schema.number().min(0).describe("0-based"),
    includeDeclaration: tool.schema.boolean().optional().describe("Include the declaration itself"),
  },
  execute: async (args, context) => {
    try {
      const result = await withLspClient(args.filePath, async (client) => {
        return (await client.references(args.filePath, args.line, args.character, args.includeDeclaration ?? true)) as
          | Location[]
          | null
      })

      if (!result || result.length === 0) {
        const output = "No references found"
        return output
      }

      const total = result.length
      const truncated = total > DEFAULT_MAX_REFERENCES
      const limited = truncated ? result.slice(0, DEFAULT_MAX_REFERENCES) : result
      const lines = limited.map(formatLocation)
      if (truncated) {
        lines.unshift(`Found ${total} references (showing first ${DEFAULT_MAX_REFERENCES}):`)
      }
      const output = lines.join("\n")
      return output
    } catch (e) {
      const output = `Error: ${e instanceof Error ? e.message : String(e)}`
      return output
    }
  },
})
