import type { AvailableTool } from "./dynamic-agent-prompt-types"

export function categorizeTools(toolNames: string[], disabledMcps: string[] = []): AvailableTool[] {
  // Filter out tools from disabled MCPs
  const disabledTools = new Set<string>()
  for (const mcp of disabledMcps) {
    if (mcp === "ast_grep") {
      disabledTools.add("ast_grep_search")
      disabledTools.add("ast_grep_replace")
    }
    if (mcp === "lsp") {
      disabledTools.add("lsp_goto_definition")
      disabledTools.add("lsp_find_references")
      disabledTools.add("lsp_symbols")
      disabledTools.add("lsp_diagnostics")
      disabledTools.add("lsp_prepare_rename")
      disabledTools.add("lsp_rename")
    }
  }
  toolNames = toolNames.filter(t => !disabledTools.has(t))

  return toolNames.map((name) => {
    let category: AvailableTool["category"] = "other"
    if (name.startsWith("lsp_")) {
      category = "lsp"
    } else if (name === "grep" || name === "glob") {
      category = "search"
    } else if (name.startsWith("session_")) {
      category = "session"
    } else if (name === "skill") {
      category = "command"
    }
    return { name, category }
  })
}

function formatToolsForPrompt(tools: AvailableTool[]): string {
  const lspTools = tools.filter((tool) => tool.category === "lsp")
  const searchTools = tools.filter((tool) => tool.category === "search")

  const parts: string[] = []

  if (searchTools.length > 0) {
    parts.push(...searchTools.map((tool) => `\`${tool.name}\``))
  }

  if (lspTools.length > 0) {
    parts.push("`lsp_*`")
  }

  return parts.join(", ")
}

export function getToolsPromptDisplay(tools: AvailableTool[]): string {
  return formatToolsForPrompt(tools)
}
