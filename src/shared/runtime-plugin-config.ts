import type { OhMyOpenCodeConfig } from "../config"

let runtimePluginConfig: OhMyOpenCodeConfig | undefined

export function setRuntimePluginConfig(config: OhMyOpenCodeConfig): void {
  runtimePluginConfig = config
}

export function getRuntimePluginConfig(): OhMyOpenCodeConfig | undefined {
  return runtimePluginConfig
}

export function clearRuntimePluginConfig(): void {
  runtimePluginConfig = undefined
}
