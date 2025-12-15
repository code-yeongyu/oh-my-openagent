import type { PluginInput } from "@opencode-ai/plugin"
import { createDynamicTruncator } from "../shared/dynamic-truncator"

const TRUNCATABLE_TOOLS = [
  "grep",
  "Grep",
  "safe_grep",
  "glob",
  "Glob",
  "safe_glob",
  "lsp_find_references",
  "lsp_document_symbols",
  "lsp_workspace_symbols",
  "lsp_diagnostics",
  "ast_grep_search",
  "interactive_bash",
  "Interactive_bash",
]

export function createToolOutputTruncatorHook(ctx: PluginInput) {
  const truncator = createDynamicTruncator(ctx)

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!TRUNCATABLE_TOOLS.includes(input.tool)) return

    try {
      const { result, truncated } = await truncator.truncate(input.sessionID, output.output)
      if (truncated) {
        output.output = result
      }
    } catch {
      // Graceful degradation - don't break tool execution
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
