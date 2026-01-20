import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../config/schema"
import { createDynamicTruncator } from "../shared/dynamic-truncator"

const DEFAULT_MAX_TOKENS = 50_000 // ~200k chars
const WEBFETCH_MAX_TOKENS = 10_000 // ~40k chars - web pages need aggressive truncation

const TRUNCATABLE_TOOLS = [
  "grep",
  "Grep",
  "safe_grep",
  "glob",
  "Glob",
  "safe_glob",
  "lsp_diagnostics",
  "ast_grep_search",
  "interactive_bash",
  "Interactive_bash",
  "skill_mcp",
  "webfetch",
  "WebFetch",
]

const TOOL_SPECIFIC_MAX_TOKENS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_TOKENS,
  WebFetch: WEBFETCH_MAX_TOKENS,
}

interface ToolOutputTruncatorOptions {
  experimental?: ExperimentalConfig
}

export function createToolOutputTruncatorHook(ctx: PluginInput, options?: ToolOutputTruncatorOptions) {
  const truncator = createDynamicTruncator(ctx)
  const truncateAll = options?.experimental?.truncate_all_tool_outputs ?? false

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (!truncateAll && !TRUNCATABLE_TOOLS.includes(input.tool)) return

    try {
      const targetMaxTokens = TOOL_SPECIFIC_MAX_TOKENS[input.tool] ?? DEFAULT_MAX_TOKENS
      const { result, truncated } = await truncator.truncate(
        input.sessionID,
        output.output,
        { targetMaxTokens }
      )
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
