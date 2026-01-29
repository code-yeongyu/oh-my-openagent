import type {
  PreCompactInput,
  PreCompactOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "../../shared"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

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
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("PreCompact", hook.command, extendedConfig ?? null)) {
        log("PreCompact hook command skipped (disabled by config)", { command: hook.command })
        continue
      }

      const hookName = hook.command.split("/").pop() || hook.command
      if (!firstHookName) firstHookName = hookName

      const result = await executeHookCommand(
        hook.command,
        JSON.stringify(stdinData),
        ctx.cwd,
        { forceZsh: DEFAULT_CONFIG.forceZsh, zshPath: DEFAULT_CONFIG.zshPath }
      )

      if (result.exitCode === 2) {
        log("PreCompact hook blocked", { hookName, stderr: result.stderr })
        continue
      }

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout || "{}") as PreCompactOutput

          if (output.hookSpecificOutput?.additionalContext) {
            collectedContext.push(...output.hookSpecificOutput.additionalContext)
          } else if (output.context) {
            collectedContext.push(...output.context)
          }

          if (output.continue === false) {
            return {
              context: collectedContext,
              elapsedMs: Date.now() - startTime,
              hookName: firstHookName,
              continue: output.continue,
              stopReason: output.stopReason,
              suppressOutput: output.suppressOutput,
              systemMessage: output.systemMessage,
            }
          }
        } catch {
          if (result.stdout.trim()) {
            collectedContext.push(result.stdout.trim())
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
