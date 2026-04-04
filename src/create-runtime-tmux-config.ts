import type { OhMyOpenCodeConfig, TmuxConfig } from "./config"
import { TmuxConfigSchema } from "./config/schema/tmux"

export function createRuntimeTmuxConfig(pluginConfig: { tmux?: OhMyOpenCodeConfig["tmux"] }): TmuxConfig {
  return TmuxConfigSchema.parse(pluginConfig.tmux ?? {})
}
