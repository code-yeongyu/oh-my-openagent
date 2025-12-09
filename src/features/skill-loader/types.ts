import type { CommandDefinition } from "../command-loader/types"

export type SkillScope = "user" | "project"

export interface SkillMetadata {
  name: string
  description: string
  model?: string
}

export interface LoadedSkillAsCommand {
  name: string
  path: string
  definition: CommandDefinition
  scope: SkillScope
}
