import type { ClaudeCodeMcpServer } from "../claude-code-mcp-loader/types"

export type SkillMcpConfig = Record<string, ClaudeCodeMcpServer>

export interface SkillMcpClientInfo {
  serverName: string
  skillName: string
  sessionID: string
}

export interface SkillMcpServerContext {
  config: ClaudeCodeMcpServer
  skillName: string
}
