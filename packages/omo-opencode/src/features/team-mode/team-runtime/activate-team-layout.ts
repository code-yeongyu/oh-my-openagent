import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { validatePluginConfig } from "../../../config/validate"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { createTeamLayout } from "../team-layout-tmux/layout"
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

/**
 * Resolve the visualization multiplexer: env override first, then the
 * `tmux.multiplexer` plugin setting from the omo config chain, then tmux.
 */
export function resolveTeamMultiplexer(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): "tmux" | "herdr" {
  const override = (env["OMO_TMUX_MULTIPLEXER"] ?? "").trim().toLowerCase()
  if (override === "herdr") return "herdr"
  if (override === "tmux") return "tmux"
  try {
    const multiplexer = validatePluginConfig(projectRoot, env).config?.tmux?.multiplexer
    if (multiplexer === "herdr") return "herdr"
  } catch {
    // Config problems surface through the config validation surfaces.
  }
  return "tmux"
}

export async function activateTeamLayout(
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  projectRoot: string,
  tmuxMgr?: TmuxSessionManager,
): Promise<boolean> {
  if (!config.tmux_visualization || !tmuxMgr) return false

  const multiplexer = resolveTeamMultiplexer(projectRoot)
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
    { multiplexer },
  )
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
