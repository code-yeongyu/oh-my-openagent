import type { OhMyOpenCodeConfig, TmuxConfig } from "./config"
import { TmuxConfigSchema } from "./config/schema/tmux"
export { isInteractiveBashEnabled } from "./interactive-bash-availability"

export function isTmuxIntegrationEnabled(
  pluginConfig: { tmux?: { enabled?: boolean } | undefined },
): boolean {
  return pluginConfig.tmux?.enabled ?? false
}

export function createRuntimeTmuxConfig(pluginConfig: { tmux?: OhMyOpenCodeConfig["tmux"] }): TmuxConfig {
  return TmuxConfigSchema.parse(pluginConfig.tmux ?? {})
}
