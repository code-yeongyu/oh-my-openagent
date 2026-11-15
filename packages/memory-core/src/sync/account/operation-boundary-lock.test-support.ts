// Step, reap, publication and cleanup helpers for operation-boundary-lock.test.ts (#12036).

import type { Subprocess } from "bun"

import { settlesWithin } from "../../git/settles-within.test-support.ts"
import { pidAlive } from "../../locks/process-liveness.test-support.ts"

const REAP_BOUND_MS = 2_000
const SETTLE_BOUND_MS = 5_000

type Closer = () => void | Promise<void>

/**
 * Closers run in reverse registration order. Each one runs even after an earlier one throws (a writer that
 * survives SIGKILL must not leak the fixture close behind it); their errors are thrown together once all ran.
 */
export const cleanupStack = () => {
  const closers: Closer[] = []
  return {
    push(close: Closer): void {
      closers.push(close)
    },
    async closeAll(): Promise<void> {
      const errors: unknown[] = []
      for (const close of closers.splice(0).reverse()) {
        try {
          await close()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) throw new AggregateError(errors, `${errors.length} cleanup closer(s) failed`)
    },
  }
}

export type CleanupStack = ReturnType<typeof cleanupStack>

export class StepStalled extends Error {
  constructor(
    readonly step: string,
    state: string,
  ) {
    super(`step '${step}' did not settle before the test's step deadline (${state})`)
  }
}

export const stepsWithin = (budgetMs: number, state: () => string) => {
  const deadline = Date.now() + budgetMs
  return async <T>(step: string, promise: Promise<T>): Promise<T> => {
    const settled = await settlesWithin(promise, Math.max(0, deadline - Date.now()))
    if (settled.kind === "still-waiting") throw new StepStalled(step, state())
    return settled.value
  }
}

export type Outcome = { readonly ok: true } | { readonly ok: false; readonly error: unknown }
// Handled from creation, so a promise the test stops waiting on can never surface as unhandled.
const outcomeOf = (promise: Promise<unknown>): Promise<Outcome> =>
  promise.then(
    (): Outcome => ({ ok: true }),
    (error: unknown): Outcome => ({ ok: false, error }),
  )

// A publication still running when a step fails keeps polling the credential lock inside the fixture
// directory, and that poll's recursive mkdir brings the directory back after the fixture is closed: an
// empty `genesis-enable-*` entry that the run's temp-root check then reports on top of the real failure.
// A fixture a publication writes into is therefore closed only once every such publication has settled.
// Closers run in reverse, so this one, registered first, runs after the writer is reaped and its lock is free.
export const closedAfterPublications = (cleanup: CleanupStack, f: { readonly close: () => Promise<void> }) => {
  const publications: Promise<Outcome>[] = []
  cleanup.push(async () => {
    const step = stepsWithin(SETTLE_BOUND_MS, () => "fixture closed regardless")
    try {
      await step("publication settled", Promise.all(publications))
    } finally {
      await f.close()
    }
  })
  return (publication: Promise<unknown>): Promise<Outcome> => {
    const outcome = outcomeOf(publication)
    publications.push(outcome)
    return outcome
  }
}

export const writerState = (child: Subprocess | undefined) => () =>
  child === undefined
    ? "writer not spawned"
    : `writer pid ${child.pid} exitCode ${String(child.exitCode)} signal ${String(child.signalCode)} alive ${String(pidAlive(child.pid))}`

// Bounded even when the exit notification is lost: a pid that is gone counts as reaped.
export const reap = async (child: Subprocess): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill("SIGKILL")
  if ((await settlesWithin(child.exited, REAP_BOUND_MS)).kind === "settled" || !pidAlive(child.pid)) return
  throw new Error(`writer ${child.pid} survived SIGKILL for ${REAP_BOUND_MS} ms`)
}
