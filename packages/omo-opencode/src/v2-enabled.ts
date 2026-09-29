import type { OhMyOpenCodeConfig } from "./config"

export function isV2HookEnabled(pluginConfig: OhMyOpenCodeConfig, name: string): boolean {
  return !(pluginConfig.disabled_hooks?.includes(name) ?? false)
}
