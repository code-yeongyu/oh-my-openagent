import type {
  ClaudeHooksConfig,
  SessionEndInput,
  SessionEndOutput,
} from "./types"
import { findMatchingHooks, log } from "../../shared"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

export interface SessionEndContext {
  sessionId: string
  cwd: string
  reason?: "clear" | "logout" | "prompt_input_exit" | "other"
}

export interface SessionEndResult {
  elapsedMs?: number
}

export async function executeSessionEndHooks(
  ctx: SessionEndContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionEndResult> {
  if (!config) {
    return {}
  }

  const matchers = findMatchingHooks(config, "SessionEnd", "*")
  if (matchers.length === 0) {
    return {}
  }

  const stdinData: SessionEndInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "SessionEnd",
    reason: ctx.reason ?? "other",
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()

  for (const matcher of matchers) {
    if (!matcher.hooks || matcher.hooks.length === 0) continue
    for (const hook of matcher.hooks) {
      if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("SessionEnd", hookName, extendedConfig ?? null)) {
        log("SessionEnd hook command skipped (disabled by config)", { command: hookName })
        continue
      }

      const result = await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)

      if (result.exitCode === 2) {
        log("SessionEnd hook returned exit code 2", { hookName, stderr: result.stderr })
        continue
      }

      if (result.stdout) {
        try {
          // Parse but discard - SessionEnd has no actionable output, but we validate
          // structure to catch misconfigured hooks early in logs.
          JSON.parse(result.stdout || "{}") as SessionEndOutput
        } catch {
          // Non-JSON output is acceptable for SessionEnd.
        }
      }
    }
  }

  return { elapsedMs: Date.now() - startTime }
}
