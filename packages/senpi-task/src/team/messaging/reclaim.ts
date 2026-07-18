import { reclaimStaleReservations } from "@oh-my-opencode/team-core/team-mailbox"

import type { TeamCoreConfig } from "../runtime-config"

export type ReclaimResult = Readonly<Record<string, readonly string[]>>

/**
 * Reclaims delivery reservations left dangling by a crash mid-delivery, one member inbox at a time,
 * restoring any `.delivering-` file older than `staleTtlMs` back to unread so the next poll/injection
 * redelivers it. Called on component `session_start`; staleness is mtime-based (team-core's own
 * reclaim), and the caller decides WHICH members to sweep from OUR task-store liveness, never from
 * team-core's opencode session-liveness helper (which is import-forbidden for the senpi team layer).
 */
export async function reclaimStaleTeamReservations(
  teamRunId: string,
  memberNames: readonly string[],
  config: TeamCoreConfig,
  staleTtlMs: number,
): Promise<ReclaimResult> {
  const result: Record<string, readonly string[]> = {}
  for (const memberName of memberNames) {
    result[memberName] = await reclaimStaleReservations(teamRunId, memberName, config, staleTtlMs)
  }
  return result
}
