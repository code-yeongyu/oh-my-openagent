import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckDefinition } from "../types"
import { checkConfig } from "./config"
import { checkModels } from "./model-resolution"
import { checkSystem, gatherSystemInfo } from "./system"
import { checkTools, gatherToolsSummary } from "./tools"

export * from "./model-resolution-types"
export type { CheckDefinition }
export { gatherSystemInfo, gatherToolsSummary }

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
