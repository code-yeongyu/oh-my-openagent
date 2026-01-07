import type { TextCompleteHook } from "./types"
import { parseMarkdownTables } from "./parser"
import { formatTablesInText } from "./formatter"
import { log } from "../../shared"

export function createTableFormatterHook(): TextCompleteHook {
  return {
    "experimental.text.complete": async (_input, output) => {
      const tables = parseMarkdownTables(output.text)
      if (tables.length === 0) return

      const beforeText = output.text
      output.text = formatTablesInText(output.text, tables)
      
      log("[table-formatter] Formatted table", {
        tableCount: tables.length,
        beforeLength: beforeText.length,
        afterLength: output.text.length,
      })
    },
  }
}

export { parseMarkdownTables } from "./parser"
export { formatTable, formatTablesInText } from "./formatter"
export type { ParsedTable, TextCompleteHook } from "./types"
