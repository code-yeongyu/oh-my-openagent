// The connector host: the one resident gateway process per (platform, account) per machine.
//
// It takes the connector lock (or reports the live holder and returns), then keeps a realtime
// `listen` open and runs `catchUp` from the cursor on every (re)connect and every interval. A
// listen that fails or ends is restarted with exponential backoff; the backoff resets once a
// session stayed up for `resetAfterMs`. An `AdapterFatal` (the platform refused the account) is
// never retried: the host writes one owner notice, reports `stopped`, and builds a fresh adapter
// only when `waitForChange` says the config or credential file changed. Aborting the signal
// (SIGTERM) stops listening, drains the events already accepted, persists the cursor, removes the
// presence row and releases the lock.

import { join } from "node:path"
import { AdapterFatal, type Platform, type SurfaceAdapter } from "../adapter/contract"
import { ConnectorCursor } from "./cursor"
import { announceFatal, stopUntilChanged } from "./fatal"
import { InboundPipeline } from "./inbound"
import { acquireConnectorLock, connectorLockPath, connectorName, connectorsDir, sweepOrphanTemps, type ConnectorLockRecord, type LockProbe } from "./lock"
import { initialPresence, PresenceWriter, presencePath } from "./presence"
import { shadowAdapter, type ConnectorSink } from "./sink"

export type BackoffPolicy = { initialMs: number; maxMs: number; resetAfterMs: number }

export const DEFAULT_BACKOFF: BackoffPolicy = { initialMs: 1_000, maxMs: 60_000, resetAfterMs: 300_000 }
export const CATCH_UP_INTERVAL_MS = 120_000
export const DRAIN_TIMEOUT_MS = 10_000

export type Sleep = (ms: number, signal: AbortSignal) => Promise<void>

export type ConnectorHostOptions = {
  agentDir: string
  scope: string
  platform: Platform
  account_id: string
  /** called only after the lock is held, so an attaching `connect` never logs in */
  createAdapter: () => SurfaceAdapter | Promise<SurfaceAdapter>
  sink: ConnectorSink
  mode: "live" | "shadow"
  once?: boolean
  signal: AbortSignal
  log?: (line: string) => void
  catchUpIntervalMs?: number
  backoff?: Partial<BackoffPolicy>
  drainTimeoutMs?: number
  sleep?: Sleep
  probe?: LockProbe
  now?: () => Date
  /** told once whether this process holds the lock or which pid does (the ensure readiness report) */
  onLock?: (decision: LockDecision) => void
  /** the one line for the scope owner when the connector stops on an AdapterFatal; default `log` */
  notice?: (text: string) => void
  /**
   * Called while stopped on an AdapterFatal: resolves true once the config or credential file
   * changed, false when `signal` aborted first. Default: stay stopped until the signal aborts.
   */
  waitForChange?: (signal: AbortSignal) => Promise<boolean>
}

export type LockDecision = { kind: "locked" | "attached"; pid: number }

export type ConnectorHostOutcome =
  | { kind: "attached"; holder: ConnectorLockRecord }
  | {
      kind: "stopped"
      emitted: number
      restarts: number
      tookOver: { pid: number | null; reason: string } | null
      /** the AdapterFatal reason the connector was stopped on when it exited, else null */
      fatal: string | null
    }

export function cursorPath(agentDir: string, platform: string, account_id: string, mode: "live" | "shadow"): string {
  const suffix = mode === "shadow" ? "shadow-cursor" : "cursor"
  return join(connectorsDir(agentDir), `${connectorName(platform, account_id)}.${suffix}.json`)
}

const abortableSleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener("abort", done, { once: true })
  })

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function settleWithin(work: Promise<void>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), ms)
  })
  try {
    return await Promise.race([work.then(() => true), timedOut])
  } finally {
    clearTimeout(timer)
  }
}

export async function runConnectorHost(options: ConnectorHostOptions): Promise<ConnectorHostOutcome> {
  const now = options.now ?? (() => new Date())
  const log = options.log ?? (() => undefined)
  const acquired = await acquireConnectorLock({
    path: connectorLockPath(options.agentDir, options.platform, options.account_id),
    platform: options.platform,
    account_id: options.account_id,
    scope: options.scope,
    ...(options.probe === undefined ? {} : { probe: options.probe }),
    now,
  })
  if (acquired.kind === "held") {
    options.onLock?.({ kind: "attached", pid: acquired.holder.pid })
    return { kind: "attached", holder: acquired.holder }
  }
  const lock = acquired.lock
  log(`holding the lock (pid ${lock.record.pid})`)
  options.onLock?.({ kind: "locked", pid: lock.record.pid })
  if (lock.tookOver !== null) log(`took over a ${lock.tookOver.reason} lock from pid ${lock.tookOver.pid ?? "unknown"}`)

  const presence = new PresenceWriter(
    presencePath(options.agentDir, options.platform, options.account_id),
    initialPresence({ ...options, pid_start: lock.record.pid_start, now: now() }),
    now,
  )
  let pipeline: InboundPipeline | null = null
  let cursor: ConnectorCursor | null = null
  let restarts = 0
  try {
    const swept = await sweepOrphanTemps(options.agentDir, options.platform, options.account_id)
    if (swept.length > 0) log(`removed ${swept.length} temp files a killed connector left behind`)
    await presence.update({})
    cursor = await ConnectorCursor.load(cursorPath(options.agentDir, options.platform, options.account_id, options.mode), {
      now: () => now().getTime(),
      onCorrupt: (movedTo) => log(`cursor unreadable, moved to ${movedTo}; starting fresh`),
    })
    pipeline = new InboundPipeline(cursor, options.sink, options.scope, log)
    const wrap = (created: SurfaceAdapter) => (options.mode === "shadow" ? shadowAdapter(created, log) : created)
    const session: Session = { adapter: wrap(await options.createAdapter()), wrap, cursor, pipeline, presence, log, now, fatal: null }
    if (options.once === true) {
      await catchUpPass(session, options.signal, true).catch(async (error: unknown) => {
        if (!(error instanceof AdapterFatal)) throw error
        await announceFatal(session, options, error)
      })
    } else restarts = await superviseListen(session, options)
    return { kind: "stopped", emitted: pipeline.emitted, restarts, tookOver: lock.tookOver, fatal: session.fatal }
  } finally {
    log("draining")
    await presence.update({ state: "draining" }).catch((error: unknown) => log(`presence write failed: ${message(error)}`))
    if (pipeline !== null && !(await settleWithin(pipeline.idle(), options.drainTimeoutMs ?? DRAIN_TIMEOUT_MS))) {
      log("drain timed out; unhandled events are replayed by the next catch-up")
    }
    await cursor?.save()
    await presence.remove()
    await lock.release()
  }
}

type Session = {
  adapter: SurfaceAdapter
  wrap: (created: SurfaceAdapter) => SurfaceAdapter
  /** the reason of the AdapterFatal the connector is stopped on, null while it runs */
  fatal: string | null
  cursor: ConnectorCursor
  pipeline: InboundPipeline
  presence: PresenceWriter
  log: (line: string) => void
  now: () => Date
}

async function catchUpPass(session: Session, signal: AbortSignal, announce: boolean): Promise<void> {
  const { adapter, cursor, pipeline, presence, now, log } = session
  const since = cursor.catchUpSince()
  const before = pipeline.emitted
  for await (const event of adapter.catchUp(since, cursor.threads())) {
    if (signal.aborted) return
    await pipeline.accept(event)
  }
  await presence.update({ last_catch_up_at: now().toISOString() })
  const fresh = pipeline.emitted - before
  if (announce || fresh > 0) log(`caught up since ${since}: ${fresh} new`)
}

async function superviseListen(session: Session, options: ConnectorHostOptions): Promise<number> {
  const backoff = { ...DEFAULT_BACKOFF, ...options.backoff }
  const sleep = options.sleep ?? abortableSleep
  const signal = options.signal
  const { log, presence, pipeline, now } = session
  let failures = 0
  let restarts = 0
  while (!signal.aborted) {
    const startedAt = now().getTime()
    const listening = new AbortController()
    const stop = () => listening.abort()
    signal.addEventListener("abort", stop, { once: true })
    let catching: Promise<void> | null = null
    let passes = 0
    const caught: { fatal: AdapterFatal | null } = { fatal: null }
    const catchUp = () => {
      passes += 1
      catching ??= catchUpPass(session, signal, passes === 1)
        .catch((error: unknown) => {
          if (error instanceof AdapterFatal) {
            caught.fatal = error
            listening.abort()
            return
          }
          log(`catch-up failed: ${message(error)}`)
          return presence.update({ last_error: `catch-up: ${message(error)}` }).catch((failure: unknown) => log(`presence write failed: ${message(failure)}`))
        })
        .finally(() => {
          catching = null
        })
    }
    let interval: ReturnType<typeof setInterval> | undefined
    let failure: unknown = null
    try {
      await session.adapter.listen(
        (event) => {
          pipeline.accept(event).catch((error: unknown) => log(`inbound ${event.event_id} failed: ${message(error)}`))
        },
        listening.signal,
        () => {
          presence.update({ state: "listening", last_error: null }).then(
            () => log("listening"),
            (error: unknown) => log(`presence write failed: ${message(error)}`),
          )
          catchUp()
          interval = setInterval(catchUp, options.catchUpIntervalMs ?? CATCH_UP_INTERVAL_MS)
        },
      )
    } catch (error) {
      failure = error
    } finally {
      clearInterval(interval)
      signal.removeEventListener("abort", stop)
      listening.abort()
    }
    if (signal.aborted) break
    await (catching ?? Promise.resolve())
    const fatal = failure instanceof AdapterFatal ? failure : caught.fatal
    if (fatal !== null) {
      if (!(await stopUntilChanged(session, options, fatal))) break
      failures = 0
      restarts += 1
      continue
    }
    if (now().getTime() - startedAt >= backoff.resetAfterMs) failures = 0
    failures += 1
    restarts += 1
    const delay = Math.min(backoff.maxMs, backoff.initialMs * 2 ** (failures - 1))
    const reason = failure === null ? "listen ended" : `listen failed: ${message(failure)}`
    log(`${reason}; reconnecting in ${delay} ms`)
    await presence.update({ state: "backoff", restarts, last_error: reason })
    await sleep(delay, signal)
  }
  return restarts
}
