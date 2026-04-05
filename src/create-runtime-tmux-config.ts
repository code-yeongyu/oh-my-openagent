import type { OhMyOpenCodeConfig, TmuxConfig } from "./config"
import { TmuxConfigSchema } from "./config/schema/tmux"

export function isTmuxIntegrationEnabled(
  pluginConfig: { tmux?: { enabled?: boolean } | undefined },
): boolean {
  return pluginConfig.tmux?.enabled ?? false
}

export function isInteractiveBashEnabled(
  which: (binary: string) => string | null = Bun.which,
): boolean {
  return which("tmux") !== null
}

export function createRuntimeTmuxConfig(pluginConfig: { tmux?: OhMyOpenCodeConfig["tmux"] }): TmuxConfig {
  return TmuxConfigSchema.parse(pluginConfig.tmux ?? {})
}
