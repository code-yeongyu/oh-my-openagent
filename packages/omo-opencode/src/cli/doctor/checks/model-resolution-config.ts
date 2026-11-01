import { validatePluginConfig } from "../../../config/validate"
import type { OmoConfig } from "./model-resolution-types"

/** The same validated, chain-materialized config the plugin runtime resolves models from. */
export function loadOmoConfig(): OmoConfig {
  const { agents, categories } = validatePluginConfig(process.cwd()).config
  return { agents, categories }
}
