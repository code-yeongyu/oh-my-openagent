export interface SkillArgs {
  name: string
}

export interface SkillInfo {
  name: string
  description: string
  location: string
  scope: "opencode-project" | "project" | "opencode" | "user"
  license?: string
  compatibility?: string
  metadata?: Record<string, string>
  allowedTools?: string[]
}

export interface SkillLoadOptions {
  /** When true, only load from OpenCode paths (.opencode/skill/, ~/.config/opencode/skill/) */
  opencodeOnly?: boolean
}
