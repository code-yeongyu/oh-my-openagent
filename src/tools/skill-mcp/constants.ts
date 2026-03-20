export const SKILL_MCP_TOOL_NAME = "skill_mcp"

export const SKILL_MCP_DESCRIPTION = `Invoke MCP server operations from skill-embedded MCPs. Requires mcp_name plus exactly one of: tool_name, resource_name, or prompt_name.`

export const BUILTIN_MCP_TOOL_HINTS: Record<string, string[]> = {
  context7: ["context7_resolve-library-id", "context7_query-docs"],
  websearch: ["websearch_web_search_exa"],
  grep_app: ["grep_app_searchGitHub"],
  code_graph_context: [
    "code-graph-context_add_code_to_graph",
    "code-graph-context_find_code",
    "code-graph-context_analyze_code_relationships",
    "code-graph-context_watch_directory",
    "code-graph-context_find_dead_code",
    "code-graph-context_find_most_complex_functions",
    "code-graph-context_execute_cypher_query",
  ],
}
