import type { CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { checkSystem, gatherSystemInfo } from "./system"
import { checkConfig } from "./config"
import { checkTools, gatherToolsSummary } from "./tools"
import { checkModels } from "./model-resolution"
import { checkTeamMode } from "./team-mode"
import { checkTuiPluginConfig } from "./tui-plugin-config"
import { checkInstallShadowing } from "./install-shadowing"

export type { CheckDefinition }
export * from "./model-resolution-types"
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
      id: CHECK_IDS.INSTALL_SHADOWING,
      name: CHECK_NAMES[CHECK_IDS.INSTALL_SHADOWING],
      check: () => checkInstallShadowing(),
    },
    {
      id: CHECK_IDS.CONFIG,
      name: CHECK_NAMES[CHECK_IDS.CONFIG],
      check: checkConfig,
    },
    {
      id: CHECK_IDS.TUI_PLUGIN,
      name: CHECK_NAMES[CHECK_IDS.TUI_PLUGIN],
      check: checkTuiPluginConfig,
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
    {
      id: CHECK_IDS.TEAM_MODE,
      name: CHECK_NAMES[CHECK_IDS.TEAM_MODE],
      check: checkTeamMode,
    },
  ]
}
