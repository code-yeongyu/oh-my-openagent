import type {
  PreCompactInput,
  PreCompactOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, log } from "../../shared"
import { dispatchHook, getHookIdentifier } from "./dispatch-hook"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"
import { normalizeHookText } from "./hook-text"

export interface PreCompactContext {
  sessionId: string
  cwd: string
}

export interface PreCompactResult {
  context: string[]
  elapsedMs?: number
  hookName?: string
  continue?: boolean
  stopReason?: string
  suppressOutput?: boolean
  systemMessage?: string
}

function appendContext(context: string[], value: string): void {
  const normalized = normalizeHookText(value)
  if (normalized !== undefined) {
    context.push(normalized)
  }
}

export async function executePreCompactHooks(
  ctx: PreCompactContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<PreCompactResult> {
  if (!config) {
    return { context: [] }
  }

  const matchers = findMatchingHooks(config, "PreCompact", "*")
  if (matchers.length === 0) {
    return { context: [] }
  }

  const stdinData: PreCompactInput = {
    session_id: ctx.sessionId,
    cwd: ctx.cwd,
    hook_event_name: "PreCompact",
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined
  const collectedContext: string[] = []

   for (const matcher of matchers) {
     if (!matcher.hooks || matcher.hooks.length === 0) continue
     for (const hook of matcher.hooks) {
       if (hook.type !== "command" && hook.type !== "http") continue

      const hookName = getHookIdentifier(hook)
      if (isHookCommandDisabled("PreCompact", hookName, extendedConfig ?? null)) {
        log("PreCompact hook command skipped (disabled by config)", { command: hookName })
        continue
      }

      if (!firstHookName) firstHookName = hookName

      const result = await dispatchHook(hook, JSON.stringify(stdinData), ctx.cwd)

      if (result.exitCode === 2) {
        log("PreCompact hook blocked", { hookName, stderr: result.stderr })
        continue
      }

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout || "{}") as PreCompactOutput

          if (output.hookSpecificOutput?.additionalContext) {
            for (const context of output.hookSpecificOutput.additionalContext) {
              appendContext(collectedContext, context)
            }
          } else if (output.context) {
            for (const context of output.context) {
              appendContext(collectedContext, context)
            }
          }

          if (output.continue === false) {
            return {
              context: collectedContext,
              elapsedMs: Date.now() - startTime,
              hookName: firstHookName,
              continue: output.continue,
              stopReason: normalizeHookText(output.stopReason),
              suppressOutput: output.suppressOutput,
              systemMessage: normalizeHookText(output.systemMessage),
            }
          }
        } catch (error) {
          if (error instanceof Error) {
            appendContext(collectedContext, result.stdout)
          } else {
            appendContext(collectedContext, result.stdout)
          }
        }
      }
    }
  }

  return {
    context: collectedContext,
    elapsedMs: Date.now() - startTime,
    hookName: firstHookName,
  }
}
