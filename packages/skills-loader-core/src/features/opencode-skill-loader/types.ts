import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import type { SkillMcpConfig } from "../../types"

export type SkillScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project" | "shared"

export interface SkillMetadata {
  name?: string
  description?: string
  model?: string
  "argument-hint"?: string
  agent?: string
  subtask?: boolean
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  "allowed-tools"?: string | string[]
  mcp?: SkillMcpConfig
}

export interface LazyContentLoader {
  loaded: boolean
  content?: string
  load: () => Promise<string>
}

export interface LoadedSkill {
  name: string
  path?: string
  resolvedPath?: string
  definition: CommandDefinition
  scope: SkillScope
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
  mcpConfig?: SkillMcpConfig
  lazyContent?: LazyContentLoader
}
