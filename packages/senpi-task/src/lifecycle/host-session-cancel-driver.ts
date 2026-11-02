import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import { TERMINAL_STATUSES, type LifecycleContext } from "./context"
import { retriesDisposed, retriesStopped } from "./deferred-revival"
import type { HostSessionCancelSink, HostSessionEnd } from "./host-session"
import { endHostSessionChild, inFlightHostSessionEnd } from "./host-session-end"

/**
 * Re-drives a no-handle host-session cancel that did not end on its first pass (omo#11765): nothing else
 * would in a live parent - the pending-cancel finish runs only at session start, and the omo#9403 deferred
 * stop resolves on a handle's connection, which this child has none of. Each backoff wait races an
 * in-flight close, so a close that never settles cannot hold the loop. Every exit but an engine dispose
 * settles the stop exactly once; a close confirmed after the loop gave up still finishes the cancel here.
 */
export function driveHostSessionCancel(context: LifecycleContext, record: TaskRecord, sink: HostSessionCancelSink): void {
  void runDriver(context, record, sink).catch((error: unknown) => {
    log("senpi-task host session cancel driver failed", { taskId: record.task_id, error: String(error) })
  })
}

async function runDriver(context: LifecycleContext, record: TaskRecord, sink: HostSessionCancelSink): Promise<void> {
  let settleOnExit = true
  try {
    // The caller just ran a pass: start by waiting, joining only a close it left in flight.
    let end = (await inFlightHostSessionEnd(context, record)?.catch(() => NOT_STARTED)) ?? NOT_STARTED
    for (const backoffMs of context.hostRetry.deferredRetryBackoffMs) {
      if (end.kind === "ended") return await sink.ended()
      if (end.kind === "pending" && (await settledFirst(end.settled, context.hostRetry.wait(backoffMs)))) return await sink.ended()
      if (end.kind !== "pending") await context.hostRetry.wait(backoffMs)
      if (retriesDisposed(context)) {
        settleOnExit = false
        return
      }
      if (retriesStopped(context, record.parent_session_id) || !stillOurs(context, record)) return
      end = await endOnce(context, record)
    }
    if (end.kind === "ended") return await sink.ended()
    if (end.kind === "pending") finishOnLateClose(context, record, end.settled, sink)
  } finally {
    if (settleOnExit) sink.settle()
  }
}

const NOT_STARTED: HostSessionEnd = { kind: "not_ended", reason: "driver_start" }

async function endOnce(context: LifecycleContext, record: TaskRecord): Promise<HostSessionEnd> {
  try {
    return await endHostSessionChild(context, record)
  } catch (error) {
    log("senpi-task host session end pass failed", { taskId: record.task_id, error: String(error) })
    return { kind: "not_ended", reason: "end_failed" }
  }
}

function settledFirst(settled: Promise<boolean>, waited: Promise<void>): Promise<boolean> {
  return Promise.race([settled.catch(() => false), waited.then(() => false)])
}

function stillOurs(context: LifecycleContext, record: TaskRecord): boolean {
  const fresh = context.store.load(record.task_id)
  if (fresh === null || TERMINAL_STATUSES.has(fresh.status) || fresh.killed === true) return false
  return fresh.notification.run_epoch === record.notification.run_epoch && fresh.residency_claim === record.residency_claim
}

function finishOnLateClose(context: LifecycleContext, record: TaskRecord, settled: Promise<boolean>, sink: HostSessionCancelSink): void {
  void settled
    .then(async (closed) => {
      if (!closed || retriesDisposed(context) || !stillOurs(context, record)) return
      await sink.ended()
    })
    .catch((error: unknown) => {
      log("senpi-task late host session close could not finish its cancel", { taskId: record.task_id, error: String(error) })
    })
}
