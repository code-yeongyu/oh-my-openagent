import type {
  ClaudeHooksConfig,
  SessionStartInput,
  SessionStartOutput,
} from "./types"
import { findMatchingHooks, log } from "../../shared"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface SessionStartContext {
  sessionId: string
  cwd: string
  source?: "startup" | "resume" | "clear" | "compact"
}

export interface SessionStartResult {
  additionalContext: string[]
  elapsedMs?: number
}

export async function executeSessionStartHooks(
  ctx: SessionStartContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionStartResult> {
  if (!config) {
    return { additionalContext: [] }
  }

  const matchers = findMatchingHooks(config, "SessionStart", "*")
  if (matchers.length === 0) {
    return { additionalContext: [] }
  }

  const stdinData: SessionStartInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "SessionStart",
    source: ctx.source,
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  const additionalContext: string[] = []

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

      if (result.exitCode === 2) {
        log("SessionStart hook returned exit code 2", { hookName, stderr: result.stderr })
        continue
      }

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout || "{}") as SessionStartOutput
          const extra = output.hookSpecificOutput?.additionalContext
          if (extra) {
            additionalContext.push(extra)
          }
        } catch {
          // Non-JSON stdout is ignored for SessionStart.
        }
      }
    }
  }

  return {
    additionalContext,
    elapsedMs: Date.now() - startTime,
  }
}
