import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { CancelOutcome } from "../steering/types"
import type { DagRunRecordV1 } from "./manager"
import { isLiveTask } from "./scheduler-context"
import type { DagRunId } from "./types"

export class DagRunChildrenLiveError extends Error {
  readonly taskIds: readonly string[]

  constructor(runId: DagRunId, survivors: readonly { readonly taskId: string; readonly detail: string }[]) {
    super(
      `DAG run "${runId}" still has live children after cancel: ${survivors
        .map(({ taskId, detail }) => `${taskId} (${detail})`)
        .join(", ")}; cancel the run again to finish stopping them`,
    )
    this.name = "DagRunChildrenLiveError"
    this.taskIds = survivors.map(({ taskId }) => taskId)
  }
}

/** Keyed by run, not by today's nodes: an amendment can remove a node whose child still runs. */
export function liveRunChildren(
  taskManager: Pick<TaskManager, "findOwnedTasks">,
  record: DagRunRecordV1,
): readonly TaskRecord[] {
  return taskManager.findOwnedTasks({ kind: "dag", runId: record.runId }).filter(isLiveTask)
}

/**
 * Stops every live child the run owns and returns what the cancel must raise, if anything (#11381).
 * A child this controller is attached to keeps its deferred in-process teardown (`abort: "skip"`,
 * disposed at the outcome boundary the scheduler awaits); any other owned child - a finished node's
 * child that resumed on its own - is cancelled outright, since no outcome may ever come for it. Stop
 * completion is re-read from the run's whole live set: a `cancel_pending` answer, a noop on a record
 * that is still live, or a child that went live after its stop is a child still running, never
 * success. The obligation stays derivable from the store, so a later cancel finds the same children.
 */
export async function stopRunChildren(
  taskManager: Pick<TaskManager, "findOwnedTasks" | "cancelTask">,
  record: DagRunRecordV1,
  attached: ReadonlySet<string>,
  reason?: string,
): Promise<unknown> {
  const outcomes = new Map<string, PromiseSettledResult<CancelOutcome>>()
  // Drained to a fixed point: each pass re-reads the run's whole live set, so a child that went live
  // while an earlier stop was pending is attempted too; every id is attempted once.
  for (;;) {
    const live = liveRunChildren(taskManager, record).map((task) => task.task_id)
    const pass = [...new Set([...attached, ...live])].filter((taskId) => !outcomes.has(taskId))
    if (pass.length === 0) break
    const results = await Promise.allSettled(
      pass.map((taskId) =>
        taskManager.cancelTask(taskId, reason, attached.has(taskId) ? { abort: "skip" } : undefined),
      ),
    )
    pass.forEach((taskId, index) => {
      const result = results[index]
      if (result !== undefined) outcomes.set(taskId, result)
    })
  }
  const rejected = [...outcomes.values()].find((result) => result.status === "rejected")
  if (rejected?.status === "rejected") return rejected.reason
  const survivors = liveRunChildren(taskManager, record).map((task) => {
    const result = outcomes.get(task.task_id)
    const answer = result?.status === "fulfilled" ? describe(result.value) : "not stopped"
    return { taskId: task.task_id, detail: `${task.status}, ${answer}` }
  })
  return survivors.length === 0 ? undefined : new DagRunChildrenLiveError(record.runId, survivors)
}

export async function stopSettledRunChildren(
  taskManager: TaskManager,
  record: DagRunRecordV1,
  reason?: string,
): Promise<void> {
  const failure = await stopRunChildren(taskManager, record, new Set(), reason)
  if (failure !== undefined) throw failure
}

function describe(outcome: CancelOutcome): string {
  return outcome.kind === "cancel_pending" || outcome.kind === "noop"
    ? `${outcome.kind}: ${outcome.reason}`
    : outcome.kind
}
