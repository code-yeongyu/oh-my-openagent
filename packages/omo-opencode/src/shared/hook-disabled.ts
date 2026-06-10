import type { ClaudeHookEvent, PluginConfig } from "../hooks/claude-code-hooks/types"

export function isHookDisabled(
  config: PluginConfig,
  hookType: ClaudeHookEvent
): boolean {
  const { disabledHooks } = config

  if (disabledHooks === undefined) {
    return false
  }

  if (disabledHooks === true) {
    return true
  }

  if (Array.isArray(disabledHooks)) {
    return disabledHooks.includes(hookType)
  }

  return false
}
