import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayoutWithReason } from "../team-layout-tmux/layout"
import type { TeamLayoutResult } from "../team-layout-tmux/layout"
import type { RuntimeState } from "../types"
import { transitionRuntimeState } from "../team-state-store/store"

function normalizeTeamLayout(teamRunId: string, layout: TeamLayoutResult): TeamLayoutResult {
  return {
    ...layout,
    targetSessionId: layout.targetSessionId ?? `omo-team-${teamRunId}`,
    ownedSession: layout.ownedSession ?? true,
  }
}

export type TeamLayoutActivation = {
  activated: boolean
  skipReason?: string
}

export async function activateTeamLayout(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  projectRoot: string,
  tmuxMgr?: TmuxSessionManager,
): Promise<TeamLayoutActivation> {
  if (!config.tmux_visualization || !tmuxMgr) return { activated: false }

  const attempt = await createTeamLayoutWithReason(
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
  const layout = attempt.layout
  if (!layout) {
    return attempt.skipReason ? { activated: false, skipReason: attempt.skipReason } : { activated: false }
  }
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
  return { activated: true }
}
