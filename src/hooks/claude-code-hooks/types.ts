// Temporary stub types for Task 0 - will be fully implemented in Task 1
// These are minimal definitions to allow shared utilities to type-check

export interface HookCommand {
  type: string
  command: string
}

export interface HookMatcher {
  matcher: string
  hooks: HookCommand[]
}

export interface ClaudeHooksConfig {
  PreToolUse?: HookMatcher[]
  PostToolUse?: HookMatcher[]
  UserPromptSubmit?: HookMatcher[]
  Stop?: HookMatcher[]
}

export type ClaudeHookEvent = "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"

export interface PluginConfig {
  disabledHooks?: boolean | ClaudeHookEvent[]
}
