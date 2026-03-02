import type { HookAction } from "./types"
import type { CommandResult } from "../../shared/command-executor/execute-hook-command"
import { executeHookCommand } from "../../shared"
import { executeHttpHook } from "./execute-http-hook"
import { DEFAULT_CONFIG } from "./plugin-config"

export function getHookIdentifier(hook: HookAction): string {
  if (hook.type === "http") return hook.url
  return hook.command.split("/").pop() || hook.command
}

export async function dispatchHook(
  hook: HookAction,
  stdinJson: string,
  cwd: string
): Promise<CommandResult> {
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
