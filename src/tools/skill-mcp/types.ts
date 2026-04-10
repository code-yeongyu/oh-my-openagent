export interface SkillMcpArgs {
  mcp_name?: string
  skill_name?: string
  list_tools?: boolean
  tool_name?: string
  resource_name?: string
  prompt_name?: string
  arguments?: string | Record<string, unknown>
  grep?: string
}
