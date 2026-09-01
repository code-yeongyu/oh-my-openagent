import type { TeamModeConfig } from "../config"
import { log } from "../logger"
import type { TeamSessionContext } from "../session-client"
import type { RuntimeState } from "../types"
import { reconcileStaleReservationsForMember } from "./reservation-reconciliation"
import { inspectWorkerMembers, sessionExists } from "./session-liveness"
import { markDeadWorkersErrored, summarizeWorkerLiveness } from "./worker-resume-status"
import { transitionRuntimeState } from "./store"

export type ActiveResumeOutcome = "resumed" | "marked_orphaned"

async function reconcileMemberReservations(
  ctx: TeamSessionContext,
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  staleReservationTtlMs: number,
): Promise<void> {
  await Promise.all(runtimeState.members.map(async (member) => {
    try {
      await reconcileStaleReservationsForMember(
        ctx,
        runtimeState.teamRunId,
        member,
        config,
        staleReservationTtlMs,
      )
    } catch (reclaimError) {
      log("team mailbox reservation reclaim failed", {
        event: "team-mailbox-reclaim-failed",
        teamRunId: runtimeState.teamRunId,
        member: member.name,
        error: reclaimError instanceof Error ? reclaimError.message : String(reclaimError),
      })
    }
  }))
}

async function markActiveTeamOrphaned(runtimeState: RuntimeState, config: TeamModeConfig): Promise<void> {
  await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
    ...currentRuntimeState,
    status: "orphaned",
  }), config)
}

export async function resumeActiveTeam(
  ctx: TeamSessionContext,
  runtimeState: RuntimeState,
  config: TeamModeConfig,
  staleReservationTtlMs: number,
): Promise<ActiveResumeOutcome> {
  if (!runtimeState.leadSessionId || !(await sessionExists(ctx, runtimeState.leadSessionId))) {
    await markActiveTeamOrphaned(runtimeState, config)
    return "marked_orphaned"
  }

  await reconcileMemberReservations(ctx, runtimeState, config, staleReservationTtlMs)

  const workerCheckResults = await inspectWorkerMembers(ctx, runtimeState)
  const workerResumeStatus = summarizeWorkerLiveness(workerCheckResults)

  if (workerResumeStatus.hasAnyWorker && !workerResumeStatus.hasAliveWorker) {
    await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
      ...markDeadWorkersErrored(currentRuntimeState, workerResumeStatus.deadWorkerNames),
      status: "orphaned",
    }), config)
    return "marked_orphaned"
  }

  if (workerResumeStatus.deadWorkerNames.length > 0) {
    await transitionRuntimeState(
      runtimeState.teamRunId,
      (currentRuntimeState) => markDeadWorkersErrored(currentRuntimeState, workerResumeStatus.deadWorkerNames),
      config,
    )
  }

  return "resumed"
}
