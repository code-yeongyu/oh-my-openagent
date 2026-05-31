import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayout } from "../team-layout-tmux/layout"
import type { TeamLayoutResult } from "../team-layout-tmux/layout"
import type { RuntimeState } from "../types"
import { transitionRuntimeState } from "../team-state-store/store"

export type ActivateTeamLayoutResult = {
  ok: boolean
  reason?: string
}

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
): Promise<ActivateTeamLayoutResult> {
  if (!tmuxMgr) {
    return { ok: false, reason: "tmux 可视化已禁用：未配置 tmux 管理器" }
  }
  if (!config.tmux_visualization) {
    return { ok: false, reason: "tmux 可视化已禁用：tmux_visualization 配置为 false" }
  }
  if (!process.env.TMUX) {
    return { ok: false, reason: "tmux 可视化未启用：当前未在 tmux 会话中运行" }
  }

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
  if (!layout) {
    const serverUrl = tmuxMgr.getServerUrl()
    return { ok: false, reason: `tmux 可视化未启用：OpenCode server 未运行（${serverUrl}）。请先执行 opencode serve` }
  }
  const normalizedLayout = normalizeTeamLayout(runtimeState.teamRunId, layout)

  await transitionRuntimeState(runtimeState.teamRunId, (currentState) => ({
    ...currentState,
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
  }), config)
  return { ok: true }
}
