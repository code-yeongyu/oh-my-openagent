import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName = "init-deep"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
