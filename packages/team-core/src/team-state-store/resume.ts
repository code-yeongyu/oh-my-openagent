import type { TeamModeConfig } from "../config"
import { log } from "../logger"
import type { TeamSessionContext } from "../session-client"
import { resumeActiveTeam } from "./active-resume"
import { isCreatingStateStuck, markStuckCreatingTeamFailed } from "./creating-resume"
import { cleanTerminalTeam, finishDeletingTeam } from "./deleting-resume"
import { toError } from "./error-normalization"
import type { ResumeReport } from "./resume-report"
import { listActiveTeams, loadRuntimeState } from "./store"

export type { ResumeReport } from "./resume-report"

const CREATING_TIMEOUT_MS = 30 * 60 * 1000
const STALE_RESERVATION_TTL_MS = 10 * 60 * 1000

export async function resumeAllTeams(
  ctx: TeamSessionContext,
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
          if (!isCreatingStateStuck(runtimeState, now, CREATING_TIMEOUT_MS)) break
          await markStuckCreatingTeamFailed(runtimeState, config)
          report.marked_failed += 1
          break
        }

        case "active": {
          const activeResumeOutcome = await resumeActiveTeam(ctx, runtimeState, config, STALE_RESERVATION_TTL_MS)
          if (activeResumeOutcome === "marked_orphaned") {
            report.marked_orphaned += 1
            break
          }
          report.resumed += 1
          break
        }

        case "deleting": {
          if (await finishDeletingTeam(runtimeState, config)) {
            report.cleaned += 1
          }
          break
        }

        case "deleted":
        case "failed": {
          if (await cleanTerminalTeam(runtimeState, config)) {
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
