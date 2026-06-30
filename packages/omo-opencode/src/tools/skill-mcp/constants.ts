export const SKILL_MCP_TOOL_NAME = "skill_mcp"

export const SKILL_MCP_DESCRIPTION = `Invoke MCP server operations from skill-embedded MCPs. Requires mcp_name plus exactly one of: tool_name, resource_name, or prompt_name.`

export const BUILTIN_MCP_TOOL_HINTS: Record<string, string[]> = {
  codegraph: [
    "codegraph_codegraph_status",
    "codegraph_codegraph_explore",
    "codegraph_codegraph_search",
    "codegraph_codegraph_node",
    "codegraph_codegraph_callers",
    "codegraph_codegraph_callees",
    "codegraph_codegraph_impact",
    "codegraph_codegraph_files",
  ],
  context7: ["context7_resolve-library-id", "context7_query-docs"],
  websearch: ["websearch_web_search_exa"],
  grep_app: ["grep_app_searchGitHub"],
}
