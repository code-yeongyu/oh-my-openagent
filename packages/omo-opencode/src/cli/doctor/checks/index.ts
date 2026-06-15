import type { CheckDefinition } from "../framework/types"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import { checkSystem, gatherSystemInfo } from "./system"
import { checkConfig } from "./config"
import { checkTools, gatherToolsSummary } from "./tools"
import { checkModels } from "./model-resolution"
import { checkTeamMode } from "./team-mode"
import { checkTuiPluginConfig } from "./tui-plugin-config"
import { checkCodex, gatherCodexSummary } from "./codex"
import { CODEX_COMPONENTS_CHECK_ID, CODEX_COMPONENTS_CHECK_NAME, checkCodexComponents } from "./codex-components"

export type { CheckDefinition }
export * from "./model-resolution-types"
export { gatherSystemInfo, gatherToolsSummary }
export { gatherCodexSummary }

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

export function getCodexCheckDefinitions(): CheckDefinition[] {
  return [
    {
      id: CHECK_IDS.CODEX,
      name: CHECK_NAMES[CHECK_IDS.CODEX],
      check: checkCodex,
      critical: true,
    },
    {
      id: CODEX_COMPONENTS_CHECK_ID,
      name: CODEX_COMPONENTS_CHECK_NAME,
      check: checkCodexComponents,
    },
  ]
}
