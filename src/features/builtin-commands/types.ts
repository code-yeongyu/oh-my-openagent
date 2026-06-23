import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName = "init-deep" | "matrix-loop" | "cancel-loop" | "ulw-loop" | "refactor" | "start-work" | "stop-continuation" | "handoff" | "pickup" | "remove-deadcode" | "profile" | "end-ultrawork"
export type BuiltinCommands = Record<string, CommandDefinition>
