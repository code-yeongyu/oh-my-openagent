import type { RunnerOutcome } from "../in-process/child-handle"
import { exitTurnOutcome } from "../rpc/turn-outcome"
import type { ChildExitOutcome } from "../types"

export interface HandleWaiters {
  settleTurn(settled: RunnerOutcome): void
  flushIdle(): void
  settleExit(outcome: ChildExitOutcome): void
  waitForIdle(settled: boolean): Promise<void>
  waitForOutcome(
    turnOutcome: RunnerOutcome | undefined,
    exitOutcome: ChildExitOutcome | undefined,
    finalText: string | undefined,
  ): Promise<RunnerOutcome>
  waitForExit(outcome: ChildExitOutcome | undefined): Promise<ChildExitOutcome>
}

/** Promise wait queues for one handle's idle, turn-outcome, and exit settlement. */
export function createHandleWaiters(): HandleWaiters {
  const idleWaiters: Array<() => void> = []
  const outcomeWaiters: Array<(settled: RunnerOutcome) => void> = []
  const exitWaiters: Array<(outcome: ChildExitOutcome) => void> = []

  return {
    settleTurn: (settled) => {
      flush(idleWaiters)
      for (const waiter of outcomeWaiters.splice(0)) waiter(settled)
    },
    flushIdle: () => flush(idleWaiters),
    settleExit: (outcome) => {
      for (const waiter of exitWaiters.splice(0)) waiter(outcome)
    },
    waitForIdle: (settled) =>
      settled ? Promise.resolve() : new Promise<void>((resolve) => idleWaiters.push(resolve)),
    waitForOutcome: (turnOutcome, exitOutcome, finalText) =>
      turnOutcome !== undefined
        ? Promise.resolve(turnOutcome)
        : exitOutcome === undefined
          ? new Promise<RunnerOutcome>((resolve) => outcomeWaiters.push(resolve))
          : Promise.resolve(exitTurnOutcome(exitOutcome, finalText)),
    waitForExit: (outcome) =>
      outcome ? Promise.resolve(outcome) : new Promise<ChildExitOutcome>((resolve) => exitWaiters.push(resolve)),
  }
}

function flush(waiters: Array<() => void>): void {
  for (const waiter of waiters.splice(0)) waiter()
}
