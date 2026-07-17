import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName = "goal" | "ralph-loop" | "cancel-ralph" | "ulw-loop" | "refactor" | "start-work" | "stop-continuation" | "handoff" | "remove-ai-slops" | "hyperplan"

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
