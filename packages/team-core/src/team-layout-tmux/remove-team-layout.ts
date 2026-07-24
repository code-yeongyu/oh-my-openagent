import type {
  TeamLayoutCleanupTarget,
  TeamLayoutCleanupResult,
  TeamLayoutDeps,
  TmuxSessionManager,
} from "./layout-types"
import { OMO_TEAM_RUN_ID_OPTION } from "./caller-window-layout"
import { isValidTeamLayoutExecutionTarget } from "./execution-target"
import {
  createTeamCleanupExecution,
  resolveCleanupTmuxPath,
  resolveTmuxServerAccess,
  runTeamTmuxCleanupCommand,
} from "./team-tmux-command"

function getErrorType(error: unknown): string {
  return error instanceof Error ? "Error" : typeof error
}

function isTeamLayoutDeps(
  value: TmuxSessionManager | TeamLayoutDeps | undefined,
): value is TeamLayoutDeps {
  return value !== undefined && "runTmuxCommand" in value && "getTmuxPath" in value
}

function isTeamLayoutCleanupTarget(
  value: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
): value is TeamLayoutCleanupTarget {
  return value !== undefined && "ownedSession" in value && "targetSessionId" in value
}

export async function removeTeamLayoutWithDeps(
  teamRunId: string,
  tmuxMgrOrCleanupTarget: TmuxSessionManager | TeamLayoutCleanupTarget | undefined,
  tmuxMgrOrDeps?: TmuxSessionManager | TeamLayoutDeps,
  deps?: TeamLayoutDeps,
): Promise<TeamLayoutCleanupResult> {
  const resolvedDeps = isTeamLayoutDeps(tmuxMgrOrDeps) ? tmuxMgrOrDeps : deps
  if (!resolvedDeps) {
    throw new Error("removeTeamLayout requires dependencies")
  }

  const cleanupTarget = isTeamLayoutCleanupTarget(tmuxMgrOrCleanupTarget)
    ? tmuxMgrOrCleanupTarget
    : undefined
  if (!cleanupTarget?.executionTarget) {
    resolvedDeps.log("tmux team layout cleanup skipped without persisted execution target", {
      kind: "warning",
      teamRunId,
    })
    return {
      attemptedPaneIds: [],
      removedPaneIds: [],
      skippedPaneIds: cleanupTarget?.paneIds ?? [],
      reason: "missing-execution-target",
    }
  }
  if (!isValidTeamLayoutExecutionTarget(cleanupTarget.executionTarget)) {
    resolvedDeps.log("tmux team layout cleanup skipped for invalid execution target", {
      kind: "warning",
      teamRunId,
    })
    return {
      attemptedPaneIds: [],
      removedPaneIds: [],
      skippedPaneIds: cleanupTarget.paneIds ?? [],
      reason: "invalid-execution-target",
    }
  }
  if (!cleanupTarget.paneIds || cleanupTarget.paneIds.length === 0) {
    resolvedDeps.log("tmux team layout cleanup skipped without owned pane identifiers", {
      kind: "warning",
      teamRunId,
    })
    return {
      attemptedPaneIds: [],
      removedPaneIds: [],
      skippedPaneIds: [],
      reason: "missing-pane-identifiers",
    }
  }

  const attemptedPaneIds = [...cleanupTarget.paneIds]
  const removedPaneIds: string[] = []
  const skippedPaneIds: string[] = []
  let removalFailed = false
  try {
    const tmuxPath = await resolveCleanupTmuxPath(
      cleanupTarget.executionTarget,
      resolvedDeps.getTmuxPath,
      resolvedDeps.getTmuxPathForBackend,
    )
    if (!tmuxPath) {
      resolvedDeps.log("tmux team layout cleanup skipped because the backend executable is unavailable", {
        kind: "warning",
        teamRunId,
      })
      return {
        attemptedPaneIds,
        removedPaneIds,
        skippedPaneIds: attemptedPaneIds,
        reason: "backend-unavailable",
      }
    }
    const tmuxMgr = isTeamLayoutDeps(tmuxMgrOrDeps) ? undefined : tmuxMgrOrDeps
    const paneEnvironment = tmuxMgr
      ? resolveTmuxServerAccess(tmuxMgr, resolvedDeps).getPaneEnvironment()
      : {}
    const cleanupExecution = createTeamCleanupExecution(
      cleanupTarget.executionTarget,
      paneEnvironment,
      resolvedDeps.getEnvironment?.() ?? process.env,
    )

    for (const paneId of cleanupTarget.paneIds) {
      try {
        const ownership = await runTeamTmuxCleanupCommand(
          tmuxPath,
          ["show-options", "-p", "-qv", "-t", paneId, OMO_TEAM_RUN_ID_OPTION],
          cleanupExecution,
          resolvedDeps,
        )
        if (!ownership.success) {
          resolvedDeps.log("tmux team pane ownership check failed", {
            kind: "warning",
            paneId,
            teamRunId,
          })
          skippedPaneIds.push(paneId)
          removalFailed = true
          continue
        }
        if (ownership.output.trim() !== teamRunId) {
          resolvedDeps.log("tmux team pane cleanup skipped for unowned pane", {
            kind: "warning",
            paneId,
            teamRunId,
          })
          skippedPaneIds.push(paneId)
          continue
        }
        const removed = await runTeamTmuxCleanupCommand(
          tmuxPath,
          ["kill-pane", "-t", paneId],
          cleanupExecution,
          resolvedDeps,
        )
        if (removed.success) {
          removedPaneIds.push(paneId)
          continue
        }
        removalFailed = true
      } catch (error) {
        resolvedDeps.log("tmux team pane cleanup failed", {
          errorType: getErrorType(error),
          kind: "warning",
          paneId,
          teamRunId,
        })
        skippedPaneIds.push(paneId)
        removalFailed = true
        continue
      }
      resolvedDeps.log("tmux team pane cleanup failed", {
        kind: "warning",
        paneId,
        teamRunId,
      })
      skippedPaneIds.push(paneId)
    }
    return {
      attemptedPaneIds,
      removedPaneIds,
      skippedPaneIds,
      reason: removedPaneIds.length === attemptedPaneIds.length
        ? "removed"
        : removedPaneIds.length > 0
          ? "partial"
          : removalFailed
            ? "failed"
            : "no-owned-panes",
    }
  } catch (error) {
    resolvedDeps.log("tmux team layout cleanup failed", {
      errorType: getErrorType(error),
      teamRunId,
    })
    return {
      attemptedPaneIds,
      removedPaneIds,
      skippedPaneIds: attemptedPaneIds.filter((paneId) => !removedPaneIds.includes(paneId)),
      reason: "failed",
    }
  }
}
