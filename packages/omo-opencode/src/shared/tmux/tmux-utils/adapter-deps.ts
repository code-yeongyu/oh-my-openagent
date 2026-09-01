import type {
  ActivateTmuxPaneDeps,
  EnforceMainPaneWidthDeps,
  GetPaneDimensionsDeps,
  KillTmuxSessionDeps,
  ReplaceTmuxPaneDeps,
  SpawnTmuxPaneDeps,
  SpawnTmuxSessionDeps,
  SpawnTmuxWindowDeps,
} from "@oh-my-opencode/tmux-core"

import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import { log } from "../../logger"
import { runTmuxCommand } from "../runner"
import { isInsideTmux, isTmuxPaneCompatible } from "./environment"
import { isServerRunning } from "./server-health"

export function withPaneSpawnDeps(deps?: Partial<SpawnTmuxPaneDeps>): Partial<SpawnTmuxPaneDeps> {
  return { log, runTmuxCommand, isInsideTmux: isTmuxPaneCompatible, isServerRunning, getTmuxPath, ...deps }
}

export function withPaneReplaceDeps(deps?: Partial<ReplaceTmuxPaneDeps>): Partial<ReplaceTmuxPaneDeps> {
  return { log, runTmuxCommand, isInsideTmux: isTmuxPaneCompatible, getTmuxPath, ...deps }
}

export function withWindowSpawnDeps(deps?: Partial<SpawnTmuxWindowDeps>): Partial<SpawnTmuxWindowDeps> {
  return { log, runTmuxCommand, isInsideTmux, isServerRunning, getTmuxPath, ...deps }
}

export function withSessionSpawnDeps(deps?: Partial<SpawnTmuxSessionDeps>): Partial<SpawnTmuxSessionDeps> {
  return { log, runTmuxCommand, isInsideTmux, isServerRunning, getTmuxPath, ...deps }
}

export function paneActivateDeps(): ActivateTmuxPaneDeps {
  return { log, runTmuxCommand, isInsideTmux: isTmuxPaneCompatible, getTmuxPath }
}

export function paneDimensionsDeps(): GetPaneDimensionsDeps {
  return { getTmuxPath, runTmuxCommand }
}

export function mainPaneWidthDeps(): EnforceMainPaneWidthDeps {
  return { log, getTmuxPath, runTmuxCommand }
}

export function sessionKillDeps(): KillTmuxSessionDeps {
  return { log, runTmuxCommand, isInsideTmux, getTmuxPath }
}
