import { loadOmoConfig, type OmoConfigEnv } from "@oh-my-opencode/omo-config-core"

/**
 * The nudge is only useful when the session can actually route work to the architect category, so
 * the component asks this gate right before injecting. The config is read fresh every time: a
 * config-watch reload during the session must be able to turn the nudge on or off.
 *
 * `env` is injectable because the loader also reads the user config under `$HOME/.omo`, and tests
 * must be able to pin an empty home directory instead of the developer's own configuration.
 */
export function hasActiveArchitectCategory(cwd: string, options: { env?: OmoConfigEnv } = {}): boolean {
  try {
    const { config } = loadOmoConfig(options.env === undefined ? { cwd } : { cwd, env: options.env })
    const architect = config.categories?.["architect"]
    return architect !== undefined && architect.disable !== true
  } catch {
    return false
  }
}
