import { log } from "@oh-my-opencode/utils"

import type { TaskRecord, TaskRunStats } from "../state"
import type { TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { nowIso } from "./manager-helpers"

export type ManagedOutcome = Awaited<ReturnType<ManagedChildHandle["waitForOutcome"]>>

export type ErrorOutcomeInput = {
  readonly taskId: string
  readonly handle: ManagedChildHandle
  readonly model: string
  readonly epoch: number
  readonly outcome: Extract<ManagedOutcome, { readonly status: "error" }>
  readonly runStats: TaskRunStats | undefined
  readonly timestamp: string
}

// Live manager state the tracker reads through, so every ownership verdict is computed from the
// freshest handles and the freshest on-disk record rather than facts captured when the tracking
// cycle was armed.
export type OutcomeTrackerPorts = {
  readonly store: TaskRecordStore
  readonly now: () => number
  readonly liveHandle: (taskId: string) => ManagedChildHandle | undefined
  readonly tryLoad: (taskId: string) => TaskRecord | null
  readonly runStatsSnapshot: (taskId: string) => TaskRunStats | undefined
  readonly releaseSlot: (taskId: string, model: string, epoch: number) => void
  readonly settleWaiters: (taskId: string) => void
  readonly tryRuntimeFallback: (input: ErrorOutcomeInput) => Promise<boolean>
}

export type OutcomeTracker = {
  readonly trackOutcome: (taskId: string, handle: ManagedChildHandle, model: string, epoch: number) => void
}

// A settled outcome may only terminalize a run the manager STILL owns: the same live handle and
// the run_epoch the tracking cycle was armed under, with a record that is not suspended.
//
// Suspension forgets the handle BEFORE its abort settles ("stale outcome tracking loses ownership
// FIRST"), so the late cancelled/error outcome arrives after ownership is gone and must become a
// no-op - never a cancelled/error terminal on a suspended record. The production residency
// registry delegates forget() to manager.forget(), so ownership loss is the primary guard; the
// residency blocklist is the second wall for a record already persisted_only/rpc_detached whose
// outcome settles through a stale handle mapping.
//
// The blocklist is deliberate, NOT an allowlist of "resident": the dispose/evict teardown paths
// transition residency (disposed/evicted) while leaving status running, and the late outcome is
// the contracted path that terminalizes such a record - blocking it would strand a running record
// nobody can settle (chaos invariant 3 pins this drain behavior).
function ownsOutcome(
  ports: OutcomeTrackerPorts,
  taskId: string,
  handle: ManagedChildHandle,
  epoch: number,
): boolean {
  if (ports.liveHandle(taskId) !== handle) return false
  const fresh = ports.tryLoad(taskId)
  return (
    fresh !== null &&
    fresh.residency_state !== "persisted_only" &&
    fresh.residency_state !== "rpc_detached" &&
    fresh.notification.run_epoch === epoch
  )
}

export function createOutcomeTracker(ports: OutcomeTrackerPorts): OutcomeTracker {
  async function settleErrorOutcome(input: ErrorOutcomeInput): Promise<void> {
    if (await ports.tryRuntimeFallback(input)) return
    // Re-checked after the fallback await: ownership may have moved on while it ran.
    if (!ownsOutcome(ports, input.taskId, input.handle, input.epoch)) return

    ports.releaseSlot(input.taskId, input.model, input.epoch)
    ports.store.transition(input.taskId, {
      type: "fail",
      timestamp: input.timestamp,
      error_message: input.outcome.failure.message,
      ...(input.outcome.killed === true ? { killed: true } : {}),
      ...(input.runStats === undefined ? {} : { run_stats: input.runStats }),
    })
    ports.settleWaiters(input.taskId)
  }

  function trackOutcome(taskId: string, handle: ManagedChildHandle, model: string, epoch: number): void {
    handle
      .waitForOutcome()
      .then((outcome) => {
        if (!ownsOutcome(ports, taskId, handle, epoch)) return
        const timestamp = nowIso(ports.now)
        const runStats = ports.runStatsSnapshot(taskId)
        if (outcome.status === "error") {
          void settleErrorOutcome({
            taskId,
            handle,
            model,
            epoch,
            outcome,
            runStats,
            timestamp,
          }).catch((error: unknown) => {
            log("senpi-task manager error outcome tracking failed", {
              taskId,
              error: String(error),
            })
          })
          return
        }

        ports.releaseSlot(taskId, model, epoch)
        const runStatsField = runStats === undefined ? {} : { run_stats: runStats }
        if (outcome.status === "completed" && outcome.finalResponse.length > 0) {
          ports.store.transition(taskId, { type: "complete", timestamp, final_response: outcome.finalResponse, ...runStatsField })
        } else if (outcome.status === "completed") {
          // A clean runner exit is not evidence that the child actually started. A session with
          // only its initiating user prompt can be reported as an empty completion; never publish
          // that as success because the parent would treat the missing work as result-ready.
          ports.store.transition(taskId, {
            type: "fail",
            timestamp,
            error_message: "child turn produced no assistant output",
            ...runStatsField,
          })
        } else {
          ports.store.transition(taskId, { type: "cancel", timestamp, ...runStatsField })
        }
        ports.settleWaiters(taskId)
      })
      .catch((error: unknown) => log("senpi-task manager outcome tracking failed", { taskId, error: String(error) }))
  }

  return { trackOutcome }
}
