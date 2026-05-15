import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayout } from "../team-layout-tmux/layout"
import type { TeamLayoutOutcome, TeamLayoutResult } from "../team-layout-tmux/layout"
import type { RuntimeState } from "../types"
import { transitionRuntimeState } from "../team-state-store/store"

function normalizeTeamLayout(teamRunId: string, layout: TeamLayoutResult): TeamLayoutResult {
  return {
    ...layout,
    targetSessionId: layout.targetSessionId ?? `omo-team-${teamRunId}`,
    ownedSession: layout.ownedSession ?? true,
  }
}

function normalizeTeamLayoutSkip(layout: Extract<TeamLayoutOutcome, { skipped: true }>): RuntimeState["tmuxLayoutSkip"] {
  return {
    reason: layout.reason,
    ...(layout.detail !== undefined ? { detail: layout.detail } : {}),
    ...(layout.serverUrl !== undefined ? { serverUrl: layout.serverUrl } : {}),
    ...(layout.serverUrlSource !== undefined ? { serverUrlSource: layout.serverUrlSource } : {}),
  }
}

export async function activateTeamLayout(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  projectRoot: string,
  tmuxMgr?: TmuxSessionManager,
): Promise<boolean> {
  if (!config.tmux_visualization || !tmuxMgr) return false

  const layout = await createTeamLayout(
    runtimeState.teamRunId,
    runtimeState.members.flatMap((member) => member.sessionId && member.agentType !== "leader"
      ? [{
          name: member.name,
          sessionId: member.sessionId,
          color: member.color,
          worktreePath: member.worktreePath ?? projectRoot,
        }]
      : []),
    tmuxMgr,
  )
  if (layout.skipped) {
    const tmuxLayoutSkip = normalizeTeamLayoutSkip(layout)
    await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
      ...currentState,
      tmuxLayoutSkip,
    }), config)
    return false
  }
  const normalizedLayout = normalizeTeamLayout(runtimeState.teamRunId, layout)

  await transitionRuntimeState(runtimeState.teamRunId, (currentState) => {
    const stateWithoutLayoutSkip = { ...currentState }
    delete stateWithoutLayoutSkip.tmuxLayoutSkip
    return {
      ...stateWithoutLayoutSkip,
      tmuxLayout: {
        ownedSession: normalizedLayout.ownedSession,
        targetSessionId: normalizedLayout.targetSessionId,
        focusWindowId: normalizedLayout.focusWindowId,
        gridWindowId: normalizedLayout.gridWindowId,
      },
      members: currentState.members.map((member) => ({
        ...member,
        tmuxPaneId: normalizedLayout.focusPanesByMember[member.name] ?? member.tmuxPaneId,
        tmuxGridPaneId: normalizedLayout.gridPanesByMember[member.name] ?? member.tmuxGridPaneId,
      })),
    }
  }, config)
  return true
}
