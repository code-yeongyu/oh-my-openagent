/**
 * `OMO_SENPI_DISABLED=1` loads the omo-senpi plugin without registering anything, like the
 * `--omo-senpi-disabled` flag. A memory child that must load extensions only for a provider
 * one of them registers (#9175) sets it through the environment, because the flag is an unknown
 * option to a child that happens not to load this plugin.
 */
export const OMO_SENPI_DISABLED_ENV = "OMO_SENPI_DISABLED"

export function isOmoSenpiDisabledByEnv(env: NodeJS.ProcessEnv): boolean {
  return env[OMO_SENPI_DISABLED_ENV] === "1"
}
