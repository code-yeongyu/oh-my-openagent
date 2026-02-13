import type { CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { checkSystem, gatherSystemInfo } from "./system"
import { checkConfig } from "./config"
import { checkProviders, gatherProviderStatuses } from "./providers"
import { checkTools, gatherToolsSummary } from "./tools"
import { checkModels } from "./model-resolution"

export type { CheckDefinition }
export * from "./model-resolution-types"
export { gatherSystemInfo, gatherProviderStatuses, gatherToolsSummary }

export function getAllCheckDefinitions(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.SYSTEM,
      name: CHECK_NAMES[CHECK_IDS.SYSTEM],
      check: checkSystem,
      critical: true,
    },
    {
      id: CHECK_IDS.CONFIG,
      name: CHECK_NAMES[CHECK_IDS.CONFIG],
      check: checkConfig,
    },
    {
      id: CHECK_IDS.PROVIDERS,
      name: CHECK_NAMES[CHECK_IDS.PROVIDERS],
      check: checkProviders,
    },
    {
      id: CHECK_IDS.TOOLS,
      name: CHECK_NAMES[CHECK_IDS.TOOLS],
      check: checkTools,
    },
    {
      id: CHECK_IDS.MODELS,
      name: CHECK_NAMES[CHECK_IDS.MODELS],
      check: checkModels,
    },
  ]
}
