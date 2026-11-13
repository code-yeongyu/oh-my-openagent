import { executeHookCommand as executeHookCommandImpl } from "@oh-my-opencode/utils/command-executor/execute-hook-command"

export type { CommandResult, ExecuteHookOptions } from "@oh-my-opencode/utils/command-executor/execute-hook-command"

// An own forwarding function, not a re-export: tests mock this module, and a bun mock of a module that re-exports rebinds
// the function inside the utils package itself, which leaked into later test files in the same process (#13331).
export const executeHookCommand: typeof executeHookCommandImpl = (...args) => executeHookCommandImpl(...args)
