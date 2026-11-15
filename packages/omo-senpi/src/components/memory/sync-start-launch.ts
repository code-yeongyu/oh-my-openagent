// How the sync runner starts a repo's engine and keeps trying (#13486, #13701). A pass that defers (the keychain
// dialog, a memory repository with no first commit), throws (a credential-lock wait that timed out, a network error)
// or does not settle by its deadline is replaced by a fresh pass after a backoff that doubles to a five-minute cap.
// One failed pass never ends sync for the session. The first engine a session starts is reported at warn, so a log
// without OMO_DEBUG tells "started" from "never started".

import type { ComponentLogger } from "../../extension/types"
import { SYNC_SESSION_DEFERRED } from "./sync-session-deferred"

const DEFERRED_RETRY_MS = 15_000
const DEFERRED_RETRY_MAX_MS = 300_000
const DEFERRED_RETRY_MIN_MS = 1_000
const DEFERRED_STILL_WAITING_MS = 900_000
/** Far past the 15 s credential-lock wait plus the account read and the engine open: a pass still running is stuck. */
const START_PASS_DEADLINE_MS = 120_000

const SYNC_START_FAILED = "sync-start-failed"

/** What a start pass reports while it runs: why it defers, and the stage a stuck pass is named by. */
export interface StartPassHooks {
  deferred(message: string): void
  stage(name: string): void
  /** True once the pass was replaced at its deadline: an engine it opens then must not start. */
  replaced(): boolean
}

export interface HeldStart<T> {
  users: number
  readonly ready: Promise<T | null>
}

export interface StartLaunch<T> {
  readonly logger: Pick<ComponentLogger, "info" | "warn" | "error">
  readonly identity: string
  readonly start: (hooks: StartPassHooks) => Promise<T | null>
  readonly running: (outcome: T) => boolean
  /** Closes a running engine that a pass replaced at its deadline started late. */
  readonly discard: (outcome: T) => Promise<void>
  /** Whether `held` is still the repo's pass: a retry replaces only its own pass. */
  readonly current: (held: HeldStart<T>) => boolean
  readonly replace: (next: HeldStart<T>) => void
  readonly deferredRetryMs: number | undefined
  readonly startPassDeadlineMs: number | undefined
}

interface RetryState {
  readonly retryMs: number
  readonly previousRetryMs: number
  readonly quietMs: number
  readonly failures: number
}

const firstRetry = (deferredRetryMs: number | undefined): RetryState => ({
  retryMs: Math.max(Math.min(deferredRetryMs ?? DEFERRED_RETRY_MS, DEFERRED_RETRY_MAX_MS), DEFERRED_RETRY_MIN_MS),
  previousRetryMs: 0,
  quietMs: 0,
  failures: 0,
})

export function launchStart<T>(
  launch: StartLaunch<T>,
  users: number,
  state = firstRetry(launch.deferredRetryMs),
): HeldStart<T> {
  const { logger, identity } = launch
  let retrying = false
  let nextQuietMs = 0
  let failures = state.failures
  let stage = "account read"
  let stuck = false
  // A new backoff step says why sync waits; at the cap every pass is silent but one reminder per 15 minutes.
  const waiting = (line: string, stillLine: string, code: string): void => {
    retrying = true
    if (state.retryMs !== state.previousRetryMs) {
      logger.warn(line, { identity, code, retryMs: state.retryMs })
      return
    }
    nextQuietMs = state.quietMs + state.retryMs
    if (nextQuietMs < DEFERRED_STILL_WAITING_MS) return
    nextQuietMs = 0
    logger.warn(stillLine, { identity, code, retryMs: state.retryMs })
  }
  const pass = launch
    .start({
      deferred: (message) =>
        waiting(
          `memory sync is waiting: ${message} Sync retries on its own.`,
          `memory sync is still waiting: ${message}`,
          SYNC_SESSION_DEFERRED,
        ),
      stage: (name) => {
        stage = name
      },
      replaced: () => stuck,
    })
    .catch((error: unknown) => {
      failures += 1
      waiting(
        `memory sync failed to start: ${String(error)}. Sync retries on its own.`,
        `memory sync still cannot start: ${String(error)}`,
        SYNC_START_FAILED,
      )
      return null
    })
  const deadlineMs = launch.startPassDeadlineMs ?? START_PASS_DEADLINE_MS
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<"stuck">((resolve) => {
    timer = setTimeout(() => resolve("stuck"), deadlineMs)
    timer.unref?.()
  })
  const ready = Promise.race([pass, deadline]).then((outcome): T | null => {
    clearTimeout(timer)
    if (outcome === "stuck") {
      stuck = true
      failures += 1
      waiting(
        `memory sync start is stuck at the ${stage} after ${Math.round(deadlineMs / 1000)} s. Sync retries on its own.`,
        `memory sync start is still stuck at the ${stage}`,
        SYNC_START_FAILED,
      )
      // The replaced pass may still finish; an engine it starts then is closed, never a second engine for the repo.
      void pass.then((late) => (late !== null && launch.running(late) ? launch.discard(late) : undefined))
      return null
    }
    if (outcome !== null && launch.running(outcome))
      logger.warn(failures === 0 ? "memory sync started" : `memory sync started after ${failures} failed attempts`, {
        identity,
      })
    return outcome
  })
  const held: HeldStart<T> = { users, ready }
  void ready.then(() => {
    if (!retrying) return
    const retry = setTimeout(() => {
      if (!launch.current(held)) return
      launch.replace(
        launchStart(launch, held.users, {
          retryMs: Math.min(state.retryMs * 2, DEFERRED_RETRY_MAX_MS),
          previousRetryMs: state.retryMs,
          quietMs: nextQuietMs,
          failures,
        }),
      )
    }, state.retryMs)
    retry.unref?.()
  })
  return held
}
