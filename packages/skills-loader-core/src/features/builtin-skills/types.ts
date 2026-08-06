import type { SkillMcpConfig } from "../../types"

export interface BuiltinSkill {
  name: string
  description: string
  template: string
  resolvedPath?: string
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  agent?: string
  model?: string
  subtask?: boolean
  argumentHint?: string
  mcpConfig?: SkillMcpConfig
}
