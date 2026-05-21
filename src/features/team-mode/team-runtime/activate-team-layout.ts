import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayout } from "../team-layout-tmux/layout"
import type { TeamLayoutResult } from "../team-layout-tmux/layout"
import { reapStaleTailers } from "../team-layout-tmux/reap-stale-tailers"
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
  if (!config.tmux_visualization || !tmuxMgr) return false

  // Best-effort sweep of zombie tailers left over from dead OpenCode servers
  // before we attach a fresh team layout. Fire-and-forget: the reaper must
  // never block layout setup, and a transient failure (ps unavailable, no
  // tailers running, etc.) must not surface as a user-visible error here.
  void reapStaleTailers().catch(() => {})

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
    undefined,
    { allowInsecureLocalTls: process.env.OMO_TEAM_ALLOW_INSECURE_LOCAL_TLS === "1" },
  )
  if (!layout) return false
  const normalizedLayout = normalizeTeamLayout(runtimeState.teamRunId, layout)

  const paneIds = [
    ...Object.values(normalizedLayout.focusPanesByMember),
    ...Object.values(normalizedLayout.gridPanesByMember),
  ].filter(Boolean)

  await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
    ...currentState,
    tmuxLayout: {
      ownedSession: normalizedLayout.ownedSession,
      targetSessionId: normalizedLayout.targetSessionId,
      focusWindowId: normalizedLayout.focusWindowId,
      gridWindowId: normalizedLayout.gridWindowId,
      paneIds: paneIds.length > 0 ? paneIds : undefined,
    },
    members: currentState.members.map((member) => ({
      ...member,
      tmuxPaneId: normalizedLayout.focusPanesByMember[member.name] ?? member.tmuxPaneId,
      tmuxGridPaneId: normalizedLayout.gridPanesByMember[member.name] ?? member.tmuxGridPaneId,
    })),
  }), config)
  return true
}
