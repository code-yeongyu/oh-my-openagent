import { getCallerHerdrPaneId, getWorkspaceIdFromPaneId } from "@oh-my-opencode/herdr-core"
import { resolveTeamMultiplexer } from "@oh-my-opencode/team-core"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayout } from "../team-layout-tmux/layout"
import type { TeamLayoutResult } from "../team-layout-tmux/layout"
import { createHerdrTeamLayout } from "../team-layout-herdr/layout"
import type { RuntimeState } from "../types"
import { transitionRuntimeState } from "../team-state-store/store"

function normalizeTeamLayout(teamRunId: string, layout: TeamLayoutResult): TeamLayoutResult {
  return {
    ...layout,
    targetSessionId: layout.targetSessionId ?? `omo-team-${teamRunId}`,
    ownedSession: layout.ownedSession ?? true,
  }
}

export async function activateTeamLayout(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  projectRoot: string,
  tmuxMgr?: TmuxSessionManager,
): Promise<boolean> {
  const log = (await import("../../../shared/logger")).log
  log("[activate-team-layout] entered", {
    teamRunId: runtimeState.teamRunId,
    tmux_visualization: config.tmux_visualization,
    multiplexer: config.multiplexer,
    hasTmuxMgr: tmuxMgr !== undefined,
    memberCount: runtimeState.members.length,
  })
  if (!config.tmux_visualization || !tmuxMgr) {
    log("[activate-team-layout] GATE FAILED", {
      tmux_visualization: config.tmux_visualization,
      hasTmuxMgr: tmuxMgr !== undefined,
    })
    return false
  }

  const members = runtimeState.members.flatMap((member) => member.sessionId && member.agentType !== "leader"
    ? [{
        name: member.name,
        sessionId: member.sessionId,
        color: member.color,
        worktreePath: member.worktreePath ?? projectRoot,
      }]
    : [])

  const multiplexer = resolveTeamMultiplexer(config)
  log("[activate-team-layout] dispatch", { multiplexer, memberCount: members.length })
  const layout = multiplexer === "herdr"
    ? await createHerdrTeamLayout(runtimeState.teamRunId, members, tmuxMgr)
    : await createTeamLayout(runtimeState.teamRunId, members, tmuxMgr)
  log("[activate-team-layout] layout result", { layout: layout !== null, multiplexer })
  if (!layout) return false
  const normalizedLayout = normalizeTeamLayout(runtimeState.teamRunId, layout)
  const paneIds = [
    ...Object.values(normalizedLayout.focusPanesByMember),
    ...Object.values(normalizedLayout.gridPanesByMember),
  ]

  await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
    ...currentState,
    tmuxLayout: {
      ownedSession: normalizedLayout.ownedSession,
      targetSessionId: normalizedLayout.targetSessionId,
      focusWindowId: normalizedLayout.focusWindowId,
      gridWindowId: normalizedLayout.gridWindowId,
      ...(paneIds.length > 0 ? { paneIds } : {}),
    },
    members: currentState.members.map((member) => ({
      ...member,
      tmuxPaneId: normalizedLayout.focusPanesByMember[member.name] ?? member.tmuxPaneId,
      tmuxGridPaneId: normalizedLayout.gridPanesByMember[member.name] ?? member.tmuxGridPaneId,
    })),
  }), config)
  return true
}

export function resolveCallerHerdrWorkspaceId(): string | undefined {
  return getWorkspaceIdFromPaneId(getCallerHerdrPaneId() ?? "")
}
