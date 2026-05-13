import type { TeamModeConfig } from "../../config/schema/team-mode"
import { log } from "../../shared/logger"
import { runTmuxCommand as defaultRunTmuxCommand } from "../../shared/tmux"
import type { TmuxCommandResult } from "../../shared/tmux"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import type { TmuxSessionManager } from "../tmux-subagent/manager"
import { buildLiveTailCommand } from "./team-layout-tmux/live-tail"
import {
  listActiveTeams,
  loadRuntimeState,
  TeamFromDeadInstanceError,
} from "./team-state-store/store"

export type RecoverStaleTeamPanesDeps = {
  listActiveTeams: typeof listActiveTeams
  loadRuntimeState: typeof loadRuntimeState
  runTmuxCommand: (tmuxPath: string, args: Array<string>) => Promise<TmuxCommandResult>
  getTmuxPath: typeof getTmuxPath
  buildLiveTailCommand: typeof buildLiveTailCommand
}

const defaultDeps: RecoverStaleTeamPanesDeps = {
  listActiveTeams,
  loadRuntimeState,
  runTmuxCommand: defaultRunTmuxCommand,
  getTmuxPath,
  buildLiveTailCommand,
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "")
}

/**
 * On plugin init, re-spawns live-tail panes for any active team whose recorded
 * serverUrl differs from the current opencode server URL.  This handles the
 * case where the server was restarted (new port/URL) but team panes still
 * point at the old address.
 *
 * No-ops when: tmuxMgr is undefined, no active teams exist, tmux path is
 * unavailable, or a team's recorded URL already matches the current URL.
 *
 * Catches TeamFromDeadInstanceError per team and logs-then-skips so a single
 * orphaned team does not abort recovery for the rest.
 */
export async function recoverStaleTeamPanes(
  config: TeamModeConfig,
  tmuxMgr: TmuxSessionManager | undefined,
  deps: RecoverStaleTeamPanesDeps = defaultDeps,
): Promise<void> {
  if (!tmuxMgr) return

  const currentServerUrl = tmuxMgr.getServerUrl()
  if (!currentServerUrl) return

  const teams = await deps.listActiveTeams(config)
  if (teams.length === 0) return

  const tmuxPath = await deps.getTmuxPath()
  if (!tmuxPath) return

  for (const teamSummary of teams) {
    try {
      const rs = await deps.loadRuntimeState(teamSummary.teamRunId, config)

      // No-op when URL already matches — panes should be pointing at current server
      if (
        rs.serverUrl !== undefined &&
        normalizeUrl(rs.serverUrl) === normalizeUrl(currentServerUrl)
      ) {
        continue
      }

      log("[team-pane-url-recovery] recovering stale panes", {
        teamRunId: rs.teamRunId,
        storedUrl: rs.serverUrl,
        currentUrl: currentServerUrl,
      })

      for (const member of rs.members) {
        const paneId = member.tmuxGridPaneId
        if (!paneId || !member.sessionId) continue

        try {
          const cmd = deps.buildLiveTailCommand(currentServerUrl, member.sessionId)
          await deps.runTmuxCommand(tmuxPath, ["respawn-pane", "-k", "-t", paneId, cmd])
          log("[team-pane-url-recovery] respawned pane", {
            teamRunId: rs.teamRunId,
            member: member.name,
            paneId,
          })
        } catch (paneError) {
          log("[team-pane-url-recovery] failed to respawn pane", {
            teamRunId: rs.teamRunId,
            member: member.name,
            paneId,
            error: String(paneError),
          })
        }
      }
    } catch (teamError) {
      if (teamError instanceof TeamFromDeadInstanceError) {
        log("[team-pane-url-recovery] skipping dead-instance team", {
          teamRunId: teamSummary.teamRunId,
          error: teamError.message,
        })
        continue
      }
      log("[team-pane-url-recovery] skipping team due to error", {
        teamRunId: teamSummary.teamRunId,
        error: String(teamError),
      })
    }
  }
}
