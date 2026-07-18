import { listActiveTeams } from "@oh-my-opencode/team-core/team-state-store"
import { log } from "@oh-my-opencode/utils"

import { readMemberTaskMap } from "../member-map"
import { TEAM_LEAD_SENTINEL } from "../normalize"
import type { TeamCoreConfig } from "../runtime-config"
import type { StateDirConfig } from "../../store"
import { resolveTeamRuntimeDirs } from "../storage"
import { reclaimStaleTeamReservations } from "./reclaim"

// Mirrors team-core's own resume default (packages/team-core/.../resume.ts): a reservation older than
// ten minutes is treated as abandoned by a crash mid-delivery.
export const DEFAULT_STALE_RESERVATION_TTL_MS = 10 * 60 * 1000

export type ReconcileTeamMailboxDeps = {
  readonly stateDir: StateDirConfig
  readonly config: TeamCoreConfig
  readonly staleTtlMs?: number
  readonly currentLeadSessionId?: string
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Component `session_start` reclaim (todo-22 durability seam): for every active team run, restore any
 * delivery reservation left dangling by a crash mid-delivery back to unread so the on-revive injection
 * fallback can redeliver it. Member names come from OUR sidecar map, never team-core session-liveness.
 * Best-effort per team: a single team's read/reclaim failure is logged and skipped so a stale corner
 * can never abort the sweep or block session start.
 */
export async function reconcileTeamMailboxOnSessionStart(deps: ReconcileTeamMailboxDeps): Promise<void> {
  const staleTtlMs = deps.staleTtlMs ?? DEFAULT_STALE_RESERVATION_TTL_MS

  let teams: Awaited<ReturnType<typeof listActiveTeams>>
  try {
    teams = await listActiveTeams(deps.config)
  } catch (error) {
    log("senpi-task team session-start reclaim skipped: listActiveTeams failed", { error: toErrorMessage(error) })
    return
  }

  for (const team of teams) {
    try {
      const runtimeDir = resolveTeamRuntimeDirs(deps.stateDir, team.teamRunId).runtimeDir
      const memberNames = Object.keys(await readMemberTaskMap(runtimeDir))
      const recipients = team.leadSessionId === deps.currentLeadSessionId
        ? [...new Set([...memberNames, TEAM_LEAD_SENTINEL])]
        : memberNames
      if (recipients.length === 0) continue
      await reclaimStaleTeamReservations(team.teamRunId, recipients, deps.config, staleTtlMs)
    } catch (error) {
      log("senpi-task team session-start reclaim skipped one team", { teamRunId: team.teamRunId, error: toErrorMessage(error) })
    }
  }
}
