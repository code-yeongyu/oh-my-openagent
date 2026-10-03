import { log } from "@oh-my-opencode/utils"

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
  exited(): boolean
  intent(): SessionCloseIntent
  markIntent(intent: SessionCloseIntent): void
  markDetached(): void
  clearActive(): void
  stopHeartbeat(): void
  settle(classified: SessionExitClassification): void
}

export interface HandleTeardown {
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
  const endOnHost = async (next: "closed" | "terminated"): Promise<void> => {
    if (host.exited()) return
    if (INTENT_STRENGTH[next] > INTENT_STRENGTH[host.intent()]) host.markIntent(next)
    ending ??= (async () => {
      host.stopHeartbeat()
      await endSessionOnHost(host, next)
      const intent = host.intent()
      const reason = intent === "terminated" ? "terminated" : "client_close"
      host.settle(classifySessionExit({ cause: { kind: "session_closed", reason }, intent }))
    })()
    await ending
  }

  return {
    detach: async () => {
      host.markDetached()
      host.clearActive()
      host.stopHeartbeat()
      await host.port().detach()
    },
    close: () => endOnHost("closed"),
    terminate: () => endOnHost("terminated"),
  }
}

// Bounded teardown: a daemon that never answers must not hold the parent's shutdown open, and a
// session is never ended with a signal.
export async function endSessionOnHost(input: HostTeardownInput, next: "closed" | "terminated"): Promise<void> {
  const bestEffort = async (work: () => Promise<void>, step: string): Promise<void> => {
    try {
      await work()
    } catch (error) {
      log("senpi-task host session teardown step failed", { taskId: input.taskId, step, error: String(error) })
    }
  }
  if (next === "terminated") await settleWithin(bestEffort(() => input.port().send({ type: "abort" }), "abort"), ABORT_GRACE_MS)
  await settleWithin(bestEffort(() => input.port().close(), "close_session"), input.closeGraceMs)
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
