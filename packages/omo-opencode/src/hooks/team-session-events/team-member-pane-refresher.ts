import { refreshMemberPane, type RefreshMemberPaneDeps } from "@oh-my-opencode/team-core/team-layout-tmux/refresh-member-pane"
import type { TeamModeConfig } from "../../config/schema/team-mode"
import { loadRuntimeState } from "../../features/team-mode/team-state-store/store"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import { resolveSessionEventID } from "../../shared/event-session-id"
import { log } from "../../shared/logger"

type HookInput = { event: { type: string; properties?: unknown } }
export type HookImpl = (input: HookInput) => Promise<void>

export type PaneRefresherDeps = RefreshMemberPaneDeps & {
  now: () => number
}

const REFRESH_EVENT_TYPES = new Set(["message.updated", "message.part.updated"])
const MIN_REFRESH_INTERVAL_MS = 2_000

const defaultDeps: PaneRefresherDeps = {
  runTmuxCommand: async (tmuxPath, args, options) => {
    const { runTmuxCommand } = await import("@oh-my-opencode/tmux-core")
    return runTmuxCommand(tmuxPath, args, options)
  },
  getTmuxPath: async () => "tmux",
  log,
  now: () => Date.now(),
}

export function createTeamMemberPaneRefresher(config: TeamModeConfig, deps: PaneRefresherDeps = defaultDeps): HookImpl {
  const lastRefreshAtBySession = new Map<string, number>()

  return async ({ event }: HookInput): Promise<void> => {
    if (!config.tmux_visualization) return
    if (!REFRESH_EVENT_TYPES.has(event.type)) return

    const sessionID = resolveSessionEventID(event.properties)
    if (!sessionID) return

    const registryEntry = lookupTeamSession(sessionID)
    if (registryEntry === undefined || registryEntry.role !== "member") return

    const now = deps.now()
    const lastRefreshAt = lastRefreshAtBySession.get(sessionID)
    if (lastRefreshAt !== undefined && now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return
    lastRefreshAtBySession.set(sessionID, now)

    try {
      const runtimeState = await loadRuntimeState(registryEntry.teamRunId, config)
      const member = runtimeState.members.find((candidate) =>
        candidate.name === registryEntry.memberName
          && (candidate.sessionId === undefined || candidate.sessionId === sessionID),
      )
      const paneId = member?.tmuxPaneId
      if (!member || !paneId) return

      await refreshMemberPane({
        name: member.name,
        sessionId: sessionID,
        paneId,
        worktreePath: member.worktreePath,
      }, deps)
    } catch (error) {
      log("team member pane refresher failed", {
        event: "team-member-pane-refresher-error",
        teamRunId: registryEntry.teamRunId,
        memberName: registryEntry.memberName,
        sessionID,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
