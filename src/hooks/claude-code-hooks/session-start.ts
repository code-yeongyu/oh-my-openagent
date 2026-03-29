import type {
  SessionStartInput,
  SessionEndInput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, log } from "../../shared"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface SessionStartContext {
  sessionId: string
  parentSessionId?: string
  cwd: string
}

export interface SessionStartResult {
  messages: string[]
}

export interface SessionEndResult {
  block: false
}

export async function executeSessionStartHooks(
  ctx: SessionStartContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionStartResult> {
  if (ctx.parentSessionId) {
    return { messages: [] }
  }

  if (!config) {
    return { messages: [] }
  }

  const matchers = findMatchingHooks(config, "SessionStart")
  if (matchers.length === 0) {
    return { messages: [] }
  }

  const stdinData: SessionStartInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "SessionStart",
    hook_source: "opencode-plugin",
  }

  const messages: string[] = []

  for (const matcher of matchers) {
    if (!matcher.hooks || matcher.hooks.length === 0) continue
    for (const hook of matcher.hooks) {
      if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("SessionStart", hookName, extendedConfig ?? null)) {
        log("SessionStart hook command skipped (disabled by config)", { command: hookName })
        continue
      }

      const result = await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)

      if (result.stdout && result.stdout.trim()) {
        messages.push(result.stdout.trim())
      }
    }
  }

  return { messages }
}

export async function executeSessionEndHooks(
  ctx: SessionStartContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionEndResult> {
  if (ctx.parentSessionId) {
    return { block: false }
  }

  if (!config) {
    return { block: false }
  }

  const matchers = findMatchingHooks(config, "SessionEnd")
  if (matchers.length === 0) {
    return { block: false }
  }

  const stdinData: SessionEndInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "SessionEnd",
    hook_source: "opencode-plugin",
  }

  for (const matcher of matchers) {
    if (!matcher.hooks || matcher.hooks.length === 0) continue
    for (const hook of matcher.hooks) {
      if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("SessionEnd", hookName, extendedConfig ?? null)) {
        log("SessionEnd hook command skipped (disabled by config)", { command: hookName })
        continue
      }

      await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)
    }
  }

  return { block: false }
}
