import { log } from "@oh-my-opencode/utils"

import type { TaskRecord } from "../state"
import type { ErrorOutcomeInput, OutcomeTrackerPorts } from "./manager-outcome"

// Tree termination can reach the child before its owner. Two seconds lets a surviving manager
// confirm an independent exit without briefly publishing a teardown as a user-visible error.
export const UNEXPECTED_EXIT_CONFIRMATION_MS = 2_000

export type ExitConfirmationSchedule = (callback: () => void, delayMs: number) => () => void

const scheduleConfirmation: ExitConfirmationSchedule = (callback, delayMs) => {
  const timer = setTimeout(callback, delayMs)
  timer.unref?.()
  return () => clearTimeout(timer)
}

type PendingConfirmation = { cancel: () => void }

export function createProvisionalExitTracker(
  ports: Pick<OutcomeTrackerPorts, "store" | "now" | "liveHandle" | "scheduleExitConfirmation">,
) {
  const pending = new Map<string, PendingConfirmation>()
  const schedule = ports.scheduleExitConfirmation ?? scheduleConfirmation

  function release(taskId: string): void {
    pending.get(taskId)?.cancel()
    pending.delete(taskId)
  }

  function defer(input: ErrorOutcomeInput, owned: TaskRecord, commit: () => void): boolean {
    const exit = input.outcome.failure.exit
    if (input.handle.pid === undefined || exit === undefined || exit.kind === "spawn_error") return false
    release(input.taskId)
    const observedAt = ports.now()
    const observed = {
      observed_at: new Date(observedAt).toISOString(), run_epoch: input.epoch,
      code: exit.code, signal: exit.signal,
    }
    let persisted = false
    try {
      let applied = false
      ports.store.mutate(input.taskId, (fresh) => {
        if (fresh.status !== "running" || fresh.notification.run_epoch !== input.epoch
          || fresh.host_pid !== owned.host_pid || fresh.residency_claim !== owned.residency_claim
          || ports.liveHandle(input.taskId) !== input.handle) return fresh
        applied = true
        return { ...fresh, provisional_exit: observed, updated_at: observed.observed_at }
      })
      if (!applied) return true
      persisted = true
      ports.store.appendEvent(input.taskId, { type: "child_exit_provisional", payload: observed })
    } catch (error) {
      // A storage fault must not strand the live manager's waiter. Its ordinary terminal writer
      // still handles persistence failure, but only after this same confirmation window.
      log("senpi-task provisional exit write failed", { taskId: input.taskId, error: String(error) })
    }
    const timer: PendingConfirmation = { cancel: () => {} }
    pending.set(input.taskId, timer)
    const confirm = (): void => {
      if (pending.get(input.taskId) !== timer) return
      const fresh = ports.store.load(input.taskId)
      if (ports.liveHandle(input.taskId) !== input.handle || fresh?.status !== "running"
        || fresh.host_pid !== owned.host_pid || fresh.residency_claim !== owned.residency_claim
        || fresh.notification.run_epoch !== input.epoch
        || (persisted && fresh.provisional_exit?.observed_at !== observed.observed_at)) {
        release(input.taskId)
        return
      }
      const remaining = observedAt + UNEXPECTED_EXIT_CONFIRMATION_MS - ports.now()
      if (remaining > 0) {
        timer.cancel = schedule(confirm, remaining)
        return
      }
      pending.delete(input.taskId)
      // Executing here with the same live handle proves the owning manager survived the window.
      // Accepted edge: an own crash whose parent ALSO dies inside the window stays provisional
      // and reconciles to LOST. That conservative interruption is safer than a spurious ERROR.
      commit()
    }
    timer.cancel = schedule(confirm, UNEXPECTED_EXIT_CONFIRMATION_MS)
    return true
  }

  return { defer, release }
}
