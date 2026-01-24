import type { SkillMcpConfig } from "../skill-mcp-manager/types"

/**
 * Configuration for a skill-embedded hook.
 * Allows built-in skills to register their own lifecycle hooks.
 */
export interface BuiltinSkillHookHandler {
  /**
   * Matcher for tool names. Can be a string (exact match) or regex pattern.
   * Examples: "Read", "Write|Edit", /^(Read|Write)$/
   */
  matcher: string | RegExp
  /**
   * Handler function executed when the hook triggers.
   * For PostToolUse: receives tool output and can append messages.
   * For PreToolUse: receives tool input and can modify or block.
   */
  handler: (context: BuiltinSkillHookContext) => BuiltinSkillHookResult | Promise<BuiltinSkillHookResult>
}

/**
 * Context passed to skill hook handlers.
 */
export interface BuiltinSkillHookContext {
  tool: string
  sessionID: string
  callID: string
  args: Record<string, unknown>
  output?: string
  cwd?: string
}

/**
 * Result returned from skill hook handlers.
 */
export interface BuiltinSkillHookResult {
  /** Additional context to append to tool output */
  additionalContext?: string
  /** Whether to block the tool execution (PreToolUse only) */
  block?: boolean
  /** Reason for blocking (PreToolUse only) */
  blockReason?: string
}

/**
 * Hooks configuration for a built-in skill.
 * Skills can register handlers for different lifecycle events.
 */
export interface BuiltinSkillHooks {
  /** Handlers triggered after tool execution */
  PostToolUse?: BuiltinSkillHookHandler[]
  /** Handlers triggered before tool execution */
  PreToolUse?: BuiltinSkillHookHandler[]
}

export interface BuiltinSkill {
  name: string
  description: string
  template: string
  license?: string
  compatibility?: string
  metadata?: Record<string, unknown>
  allowedTools?: string[]
  agent?: string
  model?: string
  subtask?: boolean
  argumentHint?: string
  mcpConfig?: SkillMcpConfig
  /** Embedded hooks that activate when this skill is enabled */
  hooks?: BuiltinSkillHooks
}
