import type { LoadedSkill, LazyContentLoader } from "../../features/opencode-skill-loader"

export type CommandScope = "builtin" | "config" | "user" | "project" | "opencode" | "opencode-project"

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
  path?: string
  metadata: CommandMetadata
  content?: string
  scope: CommandScope
  lazyContentLoader?: LazyContentLoader
}

export interface SlashcommandToolOptions {
  /** Pre-loaded commands (skip discovery if provided) */
  commands?: CommandInfo[]
  /** Pre-loaded skills (skip discovery if provided) */
  skills?: LoadedSkill[]
  /** When true, merge discovered commands into the provided `commands` list on-demand. */
  mergeDiscoveredCommands?: boolean
  /** When true, merge discovered skills into the provided `skills` list on-demand. */
  mergeDiscoveredSkills?: boolean
  /**
   * When false, skip startup precomputation of tool description.
   * Useful for fast startup modes where discovery is deferred.
   */
  prewarmDescription?: boolean
}
