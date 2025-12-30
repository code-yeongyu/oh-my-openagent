import type {
  SessionEndInput,
  SessionEndOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "../../shared"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"
import { getTranscriptPath } from "./transcript"

export interface SessionEndContext {
  sessionId: string
  cwd: string
}

export interface SessionEndResult {
  elapsedMs?: number
  hookName?: string
}

export async function executeSessionEndHooks(
  ctx: SessionEndContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionEndResult> {
  if (!config) {
    return {}
  }

  const matchers = findMatchingHooks(config, "SessionEnd")
  if (matchers.length === 0) {
    return {}
  }

  const stdinData: SessionEndInput = {
    session_id: ctx.sessionId,
    transcript_path: getTranscriptPath(ctx.sessionId),
    cwd: ctx.cwd,
    hook_event_name: "SessionEnd",
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("SessionEnd", hook.command, extendedConfig ?? null)) {
        log("SessionEnd hook command skipped (disabled by config)", { command: hook.command })
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

      if (result.exitCode !== 0) {
        log("SessionEnd hook returned non-zero exit code", {
          command: hook.command,
          exitCode: result.exitCode,
          stderr: result.stderr,
        })
      }
    }
  }

  return {
    elapsedMs: Date.now() - startTime,
    hookName: firstHookName,
  }
}
