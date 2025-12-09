export type CommandScope = "user" | "project" | "opencode" | "opencode-project"

export interface CommandDefinition {
  name: string
  description?: string
  template: string
  agent?: string
  model?: string
  subtask?: boolean
  argumentHint?: string
}

export interface CommandFrontmatter {
  description?: string
  "argument-hint"?: string
  agent?: string
  model?: string
  subtask?: boolean
}

export interface LoadedCommand {
  name: string
  path: string
  definition: CommandDefinition
  scope: CommandScope
}
