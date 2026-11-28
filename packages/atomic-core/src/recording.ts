import { setTimeout as delay } from "node:timers/promises"

import type { AtomicClient } from "./client"
import type { InvalidateAtomicContext } from "./context"
import { AtomicError } from "./errors"
import {
  admitRecordingEvent,
  type AtomicRecordingAdmission,
  type AtomicRecordingEvent,
  type AtomicRecordingSession,
  type RecordingSessionState,
} from "./recording-session"

const LOCK_TIMEOUT_MS = 2000
const LOCK_RETRY_MS = 100
const DRAIN_TIMEOUT_MS = 5000

/** Exclusive for the checkout, including other sessions. Reject with lock_timeout if not acquired in time. */
export type AtomicRecordingLock = (request: {
  readonly checkout: string
  readonly timeoutMs: number
  readonly signal: AbortSignal
}) => Promise<() => void>

export type AtomicPendingRecording = {
  readonly session: AtomicRecordingSession
  readonly event: AtomicRecordingEvent
  /** An in-flight hook may already have changed the graph. Do not replay it blindly. */
  readonly state: "queued" | "in_flight"
}

type RecordingOptions = {
  readonly client: Pick<AtomicClient, "dispatchHook">
  readonly acquireLock: AtomicRecordingLock
  readonly invalidateContext: InvalidateAtomicContext
  readonly warn: (failure: { readonly session: AtomicRecordingSession; readonly error: unknown }) => void
}

type Work = Omit<AtomicPendingRecording, "state">
type RecordingKey = Pick<AtomicRecordingSession, "sessionId" | "generation">
type Lane = {
  current: RecordingSessionState
  readonly queue: Work[]
  worker?: Promise<void>
  inFlight?: Work
}

export function createAtomicRecordingCoordinator(options: RecordingOptions) {
  const lanes = new Map<string, Lane>()
  const unhealthy = new Map<string, { readonly error: unknown }>()
  const shutdown = new AbortController()
  let closing = false
  let draining: Promise<readonly AtomicPendingRecording[]> | undefined

  async function dispatch(lane: Lane, work: Work) {
    const { session, event } = work
    const release = await options.acquireLock({
      checkout: session.checkout,
      timeoutMs: LOCK_TIMEOUT_MS,
      signal: shutdown.signal,
    })
    try {
      if (shutdown.signal.aborted) return
      lane.inFlight = work
      await options.client.dispatchHook({
        agent: event.agent,
        verb: event.verb,
        payload: event.payload,
        cwd: session.cwd,
        timeoutMs: session.timeoutMs,
        signal: shutdown.signal,
      })
      if (event.verb === "stop") options.invalidateContext(session.repository)
    } finally {
      release()
    }
  }

  async function runLane(lane: Lane) {
    try {
      while (!shutdown.signal.aborted) {
        const work = lane.queue[0]
        if (work === undefined) return
        try {
          await dispatch(lane, work)
        } catch (error) {
          if (shutdown.signal.aborted) return
          if (lane.inFlight === undefined && error instanceof AtomicError && error.code === "lock_timeout") {
            await delay(LOCK_RETRY_MS)
            continue
          }
          if (!unhealthy.has(work.session.repository)) {
            unhealthy.set(work.session.repository, { error })
            options.warn({ session: work.session, error })
          }
        }
        if (shutdown.signal.aborted) return
        lane.queue.shift()
        lane.inFlight = undefined
      }
    } finally {
      lane.worker = undefined
    }
  }

  function open(session: AtomicRecordingSession): boolean {
    if (closing) return false
    const lane = lanes.get(session.sessionId)
    if (lane !== undefined && lane.current.session.generation >= session.generation) return false
    const current: RecordingSessionState = {
      session, seen: new Set(), started: false, retired: false, correlation: "complete",
    }
    if (lane === undefined) lanes.set(session.sessionId, { current, queue: [] })
    else lane.current = current
    return true
  }

  function enqueue(key: RecordingKey, event: AtomicRecordingEvent): AtomicRecordingAdmission {
    const lane = lanes.get(key.sessionId)
    if (closing || lane === undefined || lane.current.session.generation !== key.generation) return "ignored"
    const admitted = admitRecordingEvent(lane.current, event)
    if (admitted === "degraded" || (admitted === "incomplete" && lane.current.correlation === "complete")) {
      lane.current.correlation = admitted
    }
    if (admitted === "queued" || admitted === "incomplete") {
      lane.queue.push({ session: lane.current.session, event })
      lane.worker ??= Promise.resolve().then(() => runLane(lane))
    }
    return admitted
  }

  /** Closes admission and hands remaining events to the adapter for durable persistence. */
  function drain(timeoutMs = DRAIN_TIMEOUT_MS): Promise<readonly AtomicPendingRecording[]> {
    closing = true
    draining ??= new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        shutdown.abort()
        resolve([...lanes.values()].flatMap((lane) => lane.queue.map((work): AtomicPendingRecording => ({
          ...work,
          state: lane.inFlight === work ? "in_flight" : "queued",
        }))))
      }, Math.min(timeoutMs, DRAIN_TIMEOUT_MS))
      void Promise.all([...lanes.values()].map((lane) => lane.worker)).then(
        () => { clearTimeout(deadline); resolve([]) },
        (error: unknown) => { clearTimeout(deadline); reject(error) },
      )
    })
    return draining
  }

  return {
    open,
    enqueue,
    drain,
    failure: (repository: string) => unhealthy.get(repository),
    correlation: (key: RecordingKey) => {
      const current = lanes.get(key.sessionId)?.current
      return current?.session.generation === key.generation ? current.correlation : undefined
    },
  }
}
