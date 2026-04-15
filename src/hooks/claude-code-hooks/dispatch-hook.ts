import type { HookAction } from "./types"
import type { CommandResult } from "../../shared/command-executor/execute-hook-command"
import { executeHookCommand } from "../../shared"
import { executeHttpHook } from "./execute-http-hook"
import { DEFAULT_CONFIG } from "./plugin-config"
import { shouldGateProject, TRUST_ENV_VAR } from "../../features/trust-gate"
import { log } from "../../shared/logger"

export function getHookIdentifier(hook: HookAction): string {
  if (hook.type === "http") return hook.url
  return hook.command.split("/").pop() || hook.command
}

export async function dispatchHook(
  hook: HookAction,
  stdinJson: string,
  cwd: string
): Promise<CommandResult> {
  // Trust Gate: 未承認projectではhook実行をスキップ
  if (shouldGateProject(cwd)) {
    if (process.env[TRUST_ENV_VAR] !== "1") {
      log(`[trust-gate] Hook execution blocked - project not trusted: ${cwd}`)
      log(`[trust-gate] Run "opencode trust ${cwd}" to approve execution surfaces`)
      return {
        exitCode: 0,
        stdout: "",
        stderr: "[trust-gate] Hook execution disabled (project not trusted)",
      }
    }
  }

  if (hook.type === "http") {
    return executeHttpHook(hook, stdinJson)
  }

  return executeHookCommand(
    hook.command,
    stdinJson,
    cwd,
    { forceZsh: DEFAULT_CONFIG.forceZsh, zshPath: DEFAULT_CONFIG.zshPath }
  )
}
