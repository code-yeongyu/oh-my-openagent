export type CommandScope = "user" | "project" | "opencode" | "opencode-project"

export interface CommandMetadata {
  name: string
  description: string
  argumentHint?: string
  model?: string
  agent?: string
  subtask?: boolean
}

export interface CommandInfo {
  name: string
  path: string
  metadata: CommandMetadata
  content: string
  scope: CommandScope
}
