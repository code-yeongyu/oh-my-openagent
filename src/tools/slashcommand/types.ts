export type CommandScope = "user" | "project" | "opencode" | "opencode-project"

export type CommandCategory = 
  | "workflow"
  | "quality"
  | "git"
  | "research"
  | "project"
  | "utils"

export interface CommandMetadata {
  name: string
  description: string
  argumentHint?: string
  model?: string
  agent?: string
  subtask?: boolean
  category?: CommandCategory
  primary?: boolean
  step?: string
  requires?: string[]
  produces?: string[]
  next?: string | null
  linearStatus?: string
}

export interface CommandInfo {
  name: string
  path: string
  metadata: CommandMetadata
  content: string
  scope: CommandScope
}
