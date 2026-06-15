import type { CommandDefinition } from "@oh-my-opencode/claude-code-compat-core/claude-code-command-loader/types"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"

export type { CommandDefinition }

export type SkillMcpConfig = Record<string, ClaudeCodeMcpServer>

export type BrowserAutomationProvider = "playwright" | "agent-browser" | "dev-browser" | "playwright-cli"

export interface GitMasterConfig {
  readonly commit_footer?: boolean | string
  readonly include_co_authored_by?: boolean
  readonly git_env_prefix?: string
}

export interface SkillDefinition {
  readonly description?: string
  readonly template?: string
  readonly from?: string
  readonly model?: string
  readonly agent?: string
  readonly subtask?: boolean
  readonly "argument-hint"?: string
  readonly license?: string
  readonly compatibility?: string
  readonly metadata?: Record<string, unknown>
  readonly "allowed-tools"?: string[]
  readonly disable?: boolean
}

export type SkillSource = string | {
  readonly path: string
  readonly recursive?: boolean
  readonly glob?: string
}

export type SkillsConfig =
  | string[]
  | {
      readonly sources?: SkillSource[]
      readonly enable?: string[]
      readonly disable?: string[]
      readonly [skillName: string]: SkillSource[] | string[] | boolean | SkillDefinition | undefined
    }

export interface RuntimeSkillConfig {
  readonly disabled_skills?: readonly string[]
  readonly skills?: unknown
  readonly [key: string]: unknown
}

export interface CommandInfoLike {
  readonly name: string
  readonly scope: string
}
