import type { TaskManager } from "../manager/types"
import type { TaskRecord } from "../state"
import type { CancelOptions, CancelOutcome } from "../steering/types"
import type { DagRunRecordV1 } from "./manager"
import { isLiveOwnedTask } from "./scheduler-context"
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
  taskManager: Pick<TaskManager, "findOwnedTasks" | "selfResumeStopPending">,
  record: Pick<DagRunRecordV1, "runId">,
): readonly TaskRecord[] {
  return taskManager
    .findOwnedTasks({ kind: "dag", runId: record.runId })
    .filter((task) => isLiveOwnedTask(taskManager, task))
}

type StopAnswer = { readonly result: PromiseSettledResult<CancelOutcome>; readonly askAgainIfLive: boolean }
type RunChildStopper = Pick<TaskManager, "findOwnedTasks" | "cancelTask" | "selfResumeStopPending">

/**
 * Stops every live child the run owns and returns what the cancel must raise, if anything (#11381).
 * The first stop of a child this controller attached, on the run it attached, keeps its deferred
 * in-process teardown (`abort: "skip"`, disposed at the outcome boundary the scheduler awaits), bound
 * to that run by `expectedRunEpoch`; any other stop - a finished node's child that resumed on its own,
 * an attached child on a run it started itself - is an outright cancel, since no outcome the
 * scheduler awaits belongs to that run. Stop completion is re-read from the run's whole live set: a
 * `cancel_pending` answer or a noop on a record that is still live is a child still running, never
 * success. The obligation stays derivable from the store, so a later cancel finds the same children.
 */
export async function stopRunChildren(
  taskManager: RunChildStopper,
  record: DagRunRecordV1,
  attached: ReadonlySet<string>,
  reason?: string,
): Promise<unknown> {
  const answers = new Map<string, StopAnswer>()
  // Drained to a fixed point: each pass re-reads the run's whole live set. A child is asked once, and
  // asked again only if it is live after an answer that found it stopped or on another run (#12134): a
  // finished child can start a turn on its own while the cancel is still under way.
  for (;;) {
    const owned = taskManager.findOwnedTasks({ kind: "dag", runId: record.runId })
    const live = new Set(owned.filter((task) => isLiveOwnedTask(taskManager, task)).map((task) => task.task_id))
    const pass = [...new Set([...attached, ...live])].filter((taskId) => {
      const answer = answers.get(taskId)
      return answer === undefined || (answer.askAgainIfLive && live.has(taskId))
    })
    if (pass.length === 0) break
    const asked = await Promise.all(
      pass.map((taskId) => {
        const task = owned.find((entry) => entry.task_id === taskId)
        const firstAttachedStop = attached.has(taskId) && !answers.has(taskId)
        return askToStop(taskManager, taskId, reason, firstAttachedStop ? deferredTeardown(task) : undefined)
      }),
    )
    pass.forEach((taskId, index) => {
      const answer = asked[index]
      if (answer !== undefined) answers.set(taskId, answer)
    })
  }
  const rejected = [...answers.values()].find(({ result }) => result.status === "rejected")
  if (rejected?.result.status === "rejected") return rejected.result.reason
  const survivors = liveRunChildren(taskManager, record).map((task) => {
    const result = answers.get(task.task_id)?.result
    const answer = result?.status === "fulfilled" ? describe(result.value) : "not stopped"
    return { taskId: task.task_id, detail: `${task.status}, ${answer}` }
  })
  return survivors.length === 0 ? undefined : new DagRunChildrenLiveError(record.runId, survivors)
}

// The run the controller attached keeps its deferred teardown; a run the child started on its own does not.
function deferredTeardown(task: TaskRecord | undefined): CancelOptions | undefined {
  if (task === undefined) return { abort: "skip" }
  if (task.resumed_run_epoch === task.notification.run_epoch) return undefined
  return { abort: "skip", expectedRunEpoch: task.notification.run_epoch }
}

// One stop request and what its answer found: a child the answer found stopped (or on another run) is
// asked again if it is live later; one the answer found still live is reported instead, never hammered.
async function askToStop(
  taskManager: RunChildStopper,
  taskId: string,
  reason: string | undefined,
  options: CancelOptions | undefined,
): Promise<StopAnswer> {
  const [result] = await Promise.allSettled([taskManager.cancelTask(taskId, reason, options)])
  return { result, askAgainIfLive: result.status === "fulfilled" && foundStopped(result.value) }
}

function foundStopped(outcome: CancelOutcome): boolean {
  switch (outcome.kind) {
    case "cancelled":
    case "released":
    case "stale":
      return true
    case "noop":
      return outcome.status !== "pending" && outcome.status !== "running" && outcome.status !== "paused"
    case "cancel_pending":
    case "not_found":
      return false
  }
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
