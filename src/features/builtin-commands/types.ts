import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName =
  | "init-deep"
  | "ralph-loop"
  | "cancel-ralph"
  | "ulw-loop"
  | "refactor"
  | "start-work"
  | "status"
  | "revert"
  | "evolve"
  | "instinct-import"
  | "instinct-export"
  | "instinct-status"
  | "build-fix"
  | "learn"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
