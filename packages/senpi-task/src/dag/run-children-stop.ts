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

export function liveRunChildren(taskManager: TaskManager, record: DagRunRecordV1): readonly TaskRecord[] {
  return record.nodes.flatMap((node) =>
    taskManager.findOwnedTasks({ kind: "dag", runId: record.runId, nodeId: node.id }).filter(isLiveTask),
  )
}

/**
 * Stops every live child the run owns and returns what the cancel must raise, if anything (#11381).
 * A child this controller is attached to keeps its deferred in-process teardown (`abort: "skip"`,
 * disposed at the outcome boundary the scheduler awaits); any other owned child - a finished node's
 * child that resumed on its own - is cancelled outright, since no outcome may ever come for it. Stop
 * completion is re-read from each record: a `cancel_pending` answer, or a noop on a record that is
 * still live, is a child still running, never success. The obligation stays derivable from the
 * store, so a later cancel of the run finds the same live children again.
 */
export async function stopRunChildren(
  taskManager: TaskManager,
  record: DagRunRecordV1,
  attached: ReadonlySet<string>,
  reason?: string,
): Promise<unknown> {
  const taskIds = [...new Set([...attached, ...liveRunChildren(taskManager, record).map((task) => task.task_id)])]
  const results = await Promise.allSettled(
    taskIds.map((taskId) =>
      taskManager.cancelTask(taskId, reason, attached.has(taskId) ? { abort: "skip" } : undefined),
    ),
  )
  const rejected = results.find((result) => result.status === "rejected")
  if (rejected?.status === "rejected") return rejected.reason
  const survivors = taskIds.flatMap((taskId, index) => {
    const task = taskManager.get(taskId)
    const result = results[index]
    if (!isLiveTask(task) || result?.status !== "fulfilled") return []
    return [{ taskId, detail: `${task?.status}, ${describe(result.value)}` }]
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
