import type {
  SessionStartInput,
  SessionStartOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "../../shared"
import { DEFAULT_CONFIG } from "./plugin-config"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"
import { getTranscriptPath } from "./transcript"

const SESSION_START_TAG_OPEN = "<session-start-hook>"
const SESSION_START_TAG_CLOSE = "</session-start-hook>"

export interface SessionStartContext {
  sessionId: string
  cwd: string
}

export interface SessionStartResult {
  context: string[]
  elapsedMs?: number
  hookName?: string
}

export async function executeSessionStartHooks(
  ctx: SessionStartContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<SessionStartResult> {
  const context: string[] = []

  if (!config) {
    return { context }
  }

  const matchers = findMatchingHooks(config, "SessionStart")
  if (matchers.length === 0) {
    return { context }
  }

  const stdinData: SessionStartInput = {
    session_id: ctx.sessionId,
    transcript_path: getTranscriptPath(ctx.sessionId),
    cwd: ctx.cwd,
    hook_event_name: "SessionStart",
    hook_source: "opencode-plugin",
  }

  const startTime = Date.now()
  let firstHookName: string | undefined

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("SessionStart", hook.command, extendedConfig ?? null)) {
        log("SessionStart hook command skipped (disabled by config)", { command: hook.command })
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

      if (result.stdout) {
        try {
          const output = JSON.parse(result.stdout) as SessionStartOutput

          if (output.hookSpecificOutput?.additionalContext) {
            const content = output.hookSpecificOutput.additionalContext
            if (content.includes(SESSION_START_TAG_OPEN)) {
              context.push(content)
            } else {
              context.push(`${SESSION_START_TAG_OPEN}\n${content}\n${SESSION_START_TAG_CLOSE}`)
            }
          }
        } catch {
          const rawOutput = result.stdout.trim()
          if (rawOutput) {
            if (rawOutput.includes(SESSION_START_TAG_OPEN)) {
              context.push(rawOutput)
            } else {
              context.push(`${SESSION_START_TAG_OPEN}\n${rawOutput}\n${SESSION_START_TAG_CLOSE}`)
            }
          }
        }
      }

      if (result.exitCode !== 0) {
        log("SessionStart hook returned non-zero exit code", {
          command: hook.command,
          exitCode: result.exitCode,
          stderr: result.stderr,
        })
      }
    }
  }

  return {
    context,
    elapsedMs: Date.now() - startTime,
    hookName: firstHookName,
  }
}
