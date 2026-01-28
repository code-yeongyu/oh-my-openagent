import type {
  StopInput,
  StopOutput,
  ClaudeHooksConfig,
} from "./types"
import { findMatchingHooks, executeHookCommand, log } from "../../shared"
import { DEFAULT_CONFIG } from "./plugin-config"
import { getTodoPath } from "./todo"
import { isHookCommandDisabled, type PluginExtendedConfig } from "./config-loader"

// Module-level state to track stop_hook_active per session
const stopHookActiveState = new Map<string, boolean>()

export function setStopHookActive(sessionId: string, active: boolean): void {
  stopHookActiveState.set(sessionId, active)
}

export function getStopHookActive(sessionId: string): boolean {
  return stopHookActiveState.get(sessionId) ?? false
}

export interface StopContext {
  sessionId: string
  parentSessionId?: string
  cwd: string
  transcriptPath?: string
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions"
  stopHookActive?: boolean
}

export interface StopResult {
  block: boolean
  reason?: string
  stopHookActive?: boolean
  permissionMode?: "default" | "plan" | "acceptEdits" | "bypassPermissions"
  injectPrompt?: string
}

export async function executeStopHooks(
  ctx: StopContext,
  config: ClaudeHooksConfig | null,
  extendedConfig?: PluginExtendedConfig | null
): Promise<StopResult> {
  if (ctx.parentSessionId) {
    return { block: false }
  }

  if (!config) {
    return { block: false }
  }

  const matchers = findMatchingHooks(config, "Stop")
  if (matchers.length === 0) {
    return { block: false }
  }

  const stdinData: StopInput = {
    session_id: ctx.sessionId,
    transcript_path: ctx.transcriptPath,
    cwd: ctx.cwd,
    permission_mode: ctx.permissionMode ?? "bypassPermissions",
    hook_event_name: "Stop",
    stop_hook_active: stopHookActiveState.get(ctx.sessionId) ?? false,
    todo_path: getTodoPath(ctx.sessionId),
    hook_source: "opencode-plugin",
  }

  for (const matcher of matchers) {
    for (const hook of matcher.hooks) {
      if (hook.type !== "command") continue

      if (isHookCommandDisabled("Stop", hook.command, extendedConfig ?? null)) {
        log("Stop hook command skipped (disabled by config)", { command: hook.command })
        continue
      }

      const result = await executeHookCommand(
        hook.command,
        JSON.stringify(stdinData),
        ctx.cwd,
        { forceZsh: DEFAULT_CONFIG.forceZsh, zshPath: DEFAULT_CONFIG.zshPath }
      )

      // Check exit code first - exit code 2 means block
      if (result.exitCode === 2) {
        const reason = result.stderr || result.stdout || "Blocked by stop hook"
        return {
          block: true,
          reason,
          injectPrompt: reason,
        }
      }

       if (result.stdout) {
         try {
           const output = JSON.parse(result.stdout || "{}") as StopOutput
           if (output.stop_hook_active !== undefined) {
             stopHookActiveState.set(ctx.sessionId, output.stop_hook_active)
           }
           const isBlock = output.decision === "block"
           // Determine inject_prompt: prefer explicit value, fallback to reason if blocking
           const injectPrompt = output.inject_prompt ?? (isBlock && output.reason ? output.reason : undefined)
           return {
             block: isBlock,
             reason: output.reason,
             stopHookActive: output.stop_hook_active,
             permissionMode: output.permission_mode,
             injectPrompt,
           }
         } catch {
           // Ignore JSON parse errors - hook may return non-JSON output
         }
       }
    }
  }

  return { block: false }
}
