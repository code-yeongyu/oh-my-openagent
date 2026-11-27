// The typed refusals of a retry or amend re-entry, decided from the acquisition's answer on the fresh
// record (#15125).
import type { DagRunRecordV1 } from "./manager"
import { DagNodeControlError, runBusy } from "./node-control-context"
import type { DagRunAcquisition } from "./run-acquisition"
import type { DagRunId } from "./types"

export function reentryRefusal(
  runId: DagRunId,
  outcome: Exclude<DagRunAcquisition<DagRunRecordV1>, { readonly kind: "acquired" }>,
  parentSessionId: string,
  holderOf: (fresh: DagRunRecordV1) => number | undefined,
): DagNodeControlError {
  switch (outcome.kind) {
    case "missing":
      return new DagNodeControlError({ code: "run_not_found", message: `unknown dag run "${runId}"`, runId })
    case "held":
      return new DagNodeControlError({
        code: "run_not_owned",
        message: `dag run "${runId}" is held by live process ${outcome.holderPid}`,
        runId,
      })
    case "busy":
      return runBusy(runId, outcome.operation)
    case "not_eligible": {
      // The holder decides first on the same fresh record: an active node a live process runs is theirs.
      const holderPid = holderOf(outcome.record)
      if (holderPid !== undefined) return reentryRefusal(runId, { kind: "held", holderPid }, parentSessionId, holderOf)
      if (outcome.record.parentSessionId !== parentSessionId)
        return new DagNodeControlError({
          code: "run_not_owned",
          message: `dag run "${runId}" belongs to another session`,
          runId,
        })
      if (outcome.record.pause?.reason === "user_stop")
        return new DagNodeControlError({
          code: "run_paused_by_user",
          message: "only the user's Resume may restart this run",
          runId,
        })
      return stillActive(runId, outcome.record)
    }
  }
}

// A re-entry over a run with active nodes (a revived node runs on a settled run until its fold)
// is refused naming them, so the caller can retry once they settle (#15125).
function stillActive(runId: DagRunId, record: DagRunRecordV1): DagNodeControlError {
  const nodeIds = record.nodes
    .filter((node) => node.state === "scheduled" || node.state === "running")
    .map((node) => node.id)
  return new DagNodeControlError({
    code: "run_still_active",
    message:
      nodeIds.length > 0
        ? `dag run "${runId}" still runs ${nodeIds.join(", ")}; re-enter it once ${nodeIds.length === 1 ? "that node settles" : "they settle"}`
        : `dag run "${runId}" is ${record.status} with work in flight; it cannot be re-entered now`,
    runId,
    nodeIds,
  })
}
