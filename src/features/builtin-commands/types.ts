import type { CommandDefinition } from "../claude-code-command-loader"

export type BuiltinCommandName =
  | "init-deep"
  | "ralph-loop"
  | "cancel-ralph"
  | "ulw-loop"
  | "refactor"
  | "start-work"
  | "stop-continuation"  // 上游新增
  | "status"             // 本地独有
  | "revert"             // 本地独有
  | "evolve"             // 本地独有
  | "instinct-import"    // 本地独有
  | "instinct-export"    // 本地独有
  | "instinct-status"    // 本地独有
  | "build-fix"          // 本地独有
  | "learn"              // 本地独有

export interface BuiltinCommandConfig {
  disabled_commands?: BuiltinCommandName[]
}

export type BuiltinCommands = Record<string, CommandDefinition>
