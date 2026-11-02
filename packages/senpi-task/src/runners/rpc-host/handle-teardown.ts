import { log } from "@oh-my-opencode/utils"

import type { TaskStatus } from "../../state"
import { classifySessionExit, type SessionCloseIntent, type SessionExitClassification } from "./exit-mapping"
import type { HostSessionPort } from "./handle-port"

/** How long `terminate()` waits for the host to acknowledge the abort before closing anyway. */
const ABORT_GRACE_MS = 2_000

export interface HostTeardownInput {
  readonly taskId: string
  readonly closeGraceMs: number
  port(): HostSessionPort
}

export interface HandleTeardownHost extends HostTeardownInput {
  /** The open re-joined a live session, whose context may still carry an earlier terminal status. */
  readonly openedAttached: boolean
  exited(): boolean
  intent(): SessionCloseIntent
  markIntent(intent: SessionCloseIntent): void
  markDetached(): void
  clearActive(): void
  stopHeartbeat(): void
  settle(classified: SessionExitClassification): void
  markHostEndAnswered(): void
  /** Extra teardown work the owning handle registers (settlement timers, trackers). */
  onTornDown?(): void
}

export interface HandleTeardown {
  /** Publish the task's status in the session's context while this handle still holds the attachment. */
  publishTaskStatus(status: TaskStatus): Promise<void>
  /**
   * A turn is starting: publish `running` on this connection ahead of the input that starts it, so a
   * finished session that runs again is never dropped as finished. Never waits on the host.
   */
  publishRunning(): void
  /** A recovery adopted a new port: re-send a terminal status the host may have lost (#11092). */
  republishStatus(): void
  detach(): Promise<void>
  close(): Promise<void>
  terminate(): Promise<void>
}

/** How strong a close intent is: an overlapping teardown can only raise it, never lower it. */
const INTENT_STRENGTH: Readonly<Record<SessionCloseIntent, number>> = { running: 0, closed: 1, terminated: 2 }

/**
 * The handle's deliberate detach, close, and terminate lifecycle.
 *
 * Close and terminate are idempotent in either order: the strongest intent requested wins (a
 * terminate is never downgraded to a clean exit by a later close), and a teardown that overlaps one
 * already in flight joins it instead of ending the session on the host a second time.
 */
export function createHandleTeardown(host: HandleTeardownHost): HandleTeardown {
  let ending: Promise<void> | undefined
  // Whether the session may publish a terminal status: only then does a starting turn send running.
  let markedTerminal = host.openedAttached
  let lastStatus: TaskStatus | undefined
  const sendNow = (status: TaskStatus): void => {
    const failed = (error: unknown): void => log("senpi-task host task_status publish failed", { taskId: host.taskId, status, error: String(error) })
    try {
      void host.port().send({ type: "set_session_context", patch: { task_status: status } }).catch(failed)
    } catch (error) {
      failed(error)
    }
  }
  const endOnHost = async (next: "closed" | "terminated"): Promise<void> => {
    if (host.exited()) return
    if (INTENT_STRENGTH[next] > INTENT_STRENGTH[host.intent()]) host.markIntent(next)
    ending ??= (async () => {
      host.stopHeartbeat()
      host.onTornDown?.()
      if (await endSessionOnHost(host, next)) host.markHostEndAnswered()
      const intent = host.intent()
      const reason = intent === "terminated" ? "terminated" : "client_close"
      host.settle(classifySessionExit({ cause: { kind: "session_closed", reason }, intent }))
    })()
    await ending
  }

  return {
    publishTaskStatus: async (status) => {
      if (host.exited()) return
      markedTerminal = status !== "running"
      lastStatus = status
      await host.port().send({ type: "set_session_context", patch: { task_status: status } })
    },
    publishRunning: () => {
      if (host.exited() || !markedTerminal) return
      markedTerminal = false
      lastStatus = "running"
      sendNow("running")
    },
    republishStatus: () => {
      if (host.exited() || lastStatus === undefined || lastStatus === "running") return
      sendNow(lastStatus)
    },
    detach: async () => {
      host.markDetached()
      host.clearActive()
      host.stopHeartbeat()
      host.onTornDown?.()
      await host.port().detach()
    },
    close: () => endOnHost("closed"),
    terminate: () => endOnHost("terminated"),
  }
}

// Bounded teardown: a daemon that never answers must not hold the parent's shutdown open, and a
// session is never ended with a signal.
export async function endSessionOnHost(input: HostTeardownInput, next: "closed" | "terminated"): Promise<boolean> {
  const bestEffort = async (work: () => Promise<void>, step: string): Promise<void> => {
    try {
      await work()
    } catch (error) {
      log("senpi-task host session teardown step failed", { taskId: input.taskId, step, error: String(error) })
    }
  }
  if (next === "terminated") await settleWithin(bestEffort(() => input.port().send({ type: "abort" }), "abort"), ABORT_GRACE_MS)
  let answered = false
  await settleWithin(bestEffort(async () => {
    answered = await input.port().close()
  }, "close_session"), input.closeGraceMs)
  return answered
}

/** Resolve when the work settles or the budget expires, whichever comes first. */
function settleWithin(work: Promise<void>, budgetMs: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, budgetMs)
    timer.unref?.()
    void work.then(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}
