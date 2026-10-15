import type { HookAction, HookCommand } from "./types"
import type { CommandResult, ExecuteHookOptions } from "../../shared/command-executor/execute-hook-command"
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
  // Claude-compatible envelopes do not imply Claude's tool namespace. Let
  // shared hooks select OpenCode guidance without guessing from inherited env.
  try {
    const input = JSON.parse(stdinJson)
    if (input && typeof input === "object" && !Array.isArray(input)) {
      stdinJson = JSON.stringify({ ...input, hook_host: "opencode" })
    }
  } catch {
    // Preserve the existing behavior for non-JSON custom hooks.
  }
  if (hook.type === "http") {
    return executeHttpHook(hook, stdinJson)
  }

  const cmdHook = hook as HookCommand
  const options: ExecuteHookOptions = {
    forceZsh: DEFAULT_CONFIG.forceZsh,
    zshPath: DEFAULT_CONFIG.zshPath,
  }
  if (cmdHook.allowedEnvVars) {
    options.allowedEnvVars = cmdHook.allowedEnvVars
  }
  if (cmdHook.pluginRoot) {
    options.pluginRoot = cmdHook.pluginRoot
  }

  return executeHookCommand(
    hook.command,
    stdinJson,
    cwd,
    options
  )
}
