import type { OhMyOpenCodeConfig, TmuxConfig } from "./config"
import { TmuxConfigSchema } from "./config/schema/tmux"
import { bunWhich } from "./shared/bun-which-shim"

function defaultWhich(binary: string): string | null {
  return bunWhich(binary)
}

export function isTmuxIntegrationEnabled(
  pluginConfig: { tmux?: { enabled?: boolean } | undefined },
): boolean {
  return pluginConfig.tmux?.enabled ?? false
}

export function isInteractiveBashEnabled(
  which: (binary: string) => string | null = defaultWhich,
): boolean {
  return which("tmux") !== null
}

export function createRuntimeTmuxConfig(pluginConfig: { tmux?: OhMyOpenCodeConfig["tmux"] }): TmuxConfig {
  return TmuxConfigSchema.parse(pluginConfig.tmux ?? {})
}
