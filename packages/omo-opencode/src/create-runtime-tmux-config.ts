import type { OhMyOpenCodeConfig, TmuxConfig } from "./config"
import { TmuxConfigSchema } from "./config/schema/tmux"
export { isInteractiveBashEnabled } from "./interactive-bash-availability"

export function isTmuxIntegrationEnabled(
  pluginConfig: { tmux?: { enabled?: boolean } | undefined },
): boolean {
  return pluginConfig.tmux?.enabled ?? false
}

/**
 * Apply the OMO_TMUX_MULTIPLEXER env override with the same precedence as
 * the team path (resolveTeamMultiplexer): an explicit "tmux"/"herdr" wins
 * over the config chain; anything else keeps the configured backend.
 */
function applyMultiplexerEnvOverride(config: TmuxConfig, env: NodeJS.ProcessEnv): TmuxConfig {
  const override = (env["OMO_TMUX_MULTIPLEXER"] ?? "").trim().toLowerCase()
  if (override !== "tmux" && override !== "herdr") return config
  return config.multiplexer === override ? config : { ...config, multiplexer: override }
}

export function createRuntimeTmuxConfig(
  pluginConfig: { tmux?: OhMyOpenCodeConfig["tmux"] },
  env: NodeJS.ProcessEnv = process.env,
): TmuxConfig {
  return applyMultiplexerEnvOverride(TmuxConfigSchema.parse(pluginConfig.tmux ?? {}), env)
}
