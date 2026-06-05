import type { TeamModeConfig } from "../../../config/schema/team-mode"
import { log } from "../../../shared/logger"
import type { ExecutorContext } from "../../../tools/delegate-task/executor-types"
import type { RuntimeState } from "../types"
import { toError } from "./error-normalization"
import { reconcileStaleReservationsForMember } from "./reservation-reconciliation"
import type { ResumeReport } from "./resume-report"
import { cleanupMemberWorktrees, removeRuntimeDirectory } from "./runtime-cleanup"
import { inspectWorkerMembers, sessionExists } from "./session-liveness"
import { listActiveTeams, loadRuntimeState, transitionRuntimeState } from "./store"

export type { ResumeReport } from "./resume-report"

const CREATING_TIMEOUT_MS = 30 * 60 * 1000
const STALE_RESERVATION_TTL_MS = 10 * 60 * 1000

function isCreatingStateStuck(runtimeState: RuntimeState, now: number): boolean {
  return runtimeState.status === "creating" && now - runtimeState.createdAt > CREATING_TIMEOUT_MS
}

export async function resumeAllTeams(
  ctx: ExecutorContext,
  config: TeamModeConfig,
): Promise<ResumeReport> {
  const report: ResumeReport = {
    resumed: 0,
    marked_failed: 0,
    marked_orphaned: 0,
    cleaned: 0,
    errors: [],
  }
  const now = Date.now()
  const activeTeams = await listActiveTeams(config)

  for (const activeTeam of activeTeams) {
    try {
      const runtimeState = await loadRuntimeState(activeTeam.teamRunId, config)

      switch (runtimeState.status) {
        case "creating": {
          if (!isCreatingStateStuck(runtimeState, now)) break
          await cleanupMemberWorktrees(runtimeState)
          await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
            ...currentRuntimeState,
            status: "failed",
          }), config)
          report.marked_failed += 1
          break
        }

        case "active": {
          if (!runtimeState.leadSessionId || !(await sessionExists(ctx, runtimeState.leadSessionId))) {
            await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
              ...currentRuntimeState,
              status: "orphaned",
            }), config)
            report.marked_orphaned += 1
            break
          }

          await Promise.all(runtimeState.members.map(async (member) => {
            try {
              await reconcileStaleReservationsForMember(
                ctx,
                runtimeState.teamRunId,
                member,
                config,
                STALE_RESERVATION_TTL_MS,
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

          const workerCheckResults = await inspectWorkerMembers(ctx, runtimeState)
          const deadWorkerNames = new Set(
            workerCheckResults
              .filter((result) => result.wasSpawned && !result.stillAlive)
              .map((result) => result.name),
          )
          const hasAliveWorker = workerCheckResults.some((result) => result.stillAlive)
          const hasAnyWorker = workerCheckResults.length > 0

          const markDeadWorkersErrored = (currentRuntimeState: RuntimeState): RuntimeState => ({
            ...currentRuntimeState,
            members: currentRuntimeState.members.map((member) => (
              deadWorkerNames.has(member.name)
                ? { ...member, status: "errored" as const, sessionId: undefined }
                : member
            )),
          })

          if (hasAnyWorker && !hasAliveWorker) {
            await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
              ...markDeadWorkersErrored(currentRuntimeState),
              status: "orphaned",
            }), config)
            report.marked_orphaned += 1
            break
          }

          if (deadWorkerNames.size > 0) {
            await transitionRuntimeState(runtimeState.teamRunId, markDeadWorkersErrored, config)
          }

          report.resumed += 1
          break
        }

        case "deleting": {
          await cleanupMemberWorktrees(runtimeState)
          await transitionRuntimeState(runtimeState.teamRunId, (currentRuntimeState) => ({
            ...currentRuntimeState,
            status: "deleted",
          }), config)
          if (await removeRuntimeDirectory(runtimeState.teamRunId, config)) {
            report.cleaned += 1
          }
          break
        }

        case "deleted":
        case "failed": {
          if (await removeRuntimeDirectory(runtimeState.teamRunId, config)) {
            report.cleaned += 1
          }
          break
        }

        case "shutdown_requested":
        case "orphaned": {
          break
        }
      }
    } catch (error) {
      const resumeError = toError(error)
      report.errors.push(resumeError)
      log("team runtime resume failed", {
        event: "team-runtime-resume-failed",
        teamRunId: activeTeam.teamRunId,
        teamName: activeTeam.teamName,
        status: activeTeam.status,
        error: resumeError.message,
      })
    }
  }

  return report
}
