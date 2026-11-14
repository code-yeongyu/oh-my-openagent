import { statSync } from "node:fs"

import { WAKE_LEASE_MS } from "../gateway/constants"
import type { GatewayStore } from "../gateway/store"
import type { RpcObject } from "@oh-my-opencode/senpi-task/rpc-socket-client"
import type { CarrierHostConnection } from "./carrier-connection"
import { readEngineState, type EngineView } from "./engine-state"
import { resolveWakeTarget, type WakeSessionKind } from "./session-target"

/** A person's wait that arose after admission is closed after this long with only the carrier attached (A3.2.6). */
const PERSON_WAIT_CLOSE_MS = 30 * 60_000
/** How often a carrier renews its leases and sweeps (A3.1.3). */
const CARRIER_RENEW_MS = 20_000

export type CarrierWakeOutcome =
  | { readonly kind: "open"; readonly session_id: string; readonly generation: number }
  | { readonly kind: "held" }
  | { readonly kind: "waiting" }
  | { readonly kind: "wake_limit_reached" }
  | { readonly kind: "gone" }
  | { readonly kind: "ambiguous"; readonly session_paths: readonly string[] }
  | { readonly kind: "not_wakeable"; readonly session_kind: Exclude<WakeSessionKind, "interactive"> }
  | { readonly kind: "overloaded" }
  | { readonly kind: "not_yet"; readonly next_attempt_at: number }
  | { readonly kind: "busy"; readonly code: string }
  | { readonly kind: "deferred"; readonly attempts: number }
  | { readonly kind: "failed"; readonly attempts: number }
  /** No queued row of this session may be opened under the switches as they read now (A7.2.3); the row waits. */
  | { readonly kind: "switched_off" }
  /** The session holds no queued row at all, so there is nothing to open for; the record is ended (A3.1.6). */
  | { readonly kind: "nothing_queued" }

export type CarrierEvaluation =
  | { readonly kind: "released" }
  | { readonly kind: "kept"; readonly reason: "working" }
  | { readonly kind: "handed_over" }
  | { readonly kind: "close_failed"; readonly code: string }
  | { readonly kind: "waiting"; readonly since: number }
  | { readonly kind: "closed_waiting" }
  | { readonly kind: "held" }
  | { readonly kind: "lost_lease" }
  | { readonly kind: "not_carried" }

export type CarrierEvent = {
  readonly kind: "evaluated"
  readonly durable_id: string
  readonly outcome: CarrierEvaluation
}

export type CarrierOptions = {
  readonly store: GatewayStore
  readonly sessionsDirectory: string
  readonly ensureHost: () => Promise<void>
  readonly connect: () => Promise<CarrierHostConnection>
  /** `session_wake.wake_limit`; 0 means no bound (A3.5.3). */
  readonly wakeLimit?: () => number
  /**
   * `session_wake.same_device`, read at the moment of the open for the TARGET session's cwd (its project's
   * configuration); the caller passes the resolved setting (on by default).
   */
  readonly sameDevice?: (cwd: string) => boolean
  /** The gate for a row from another device: production allows it while this process's delivery consumer serves. */
  readonly remoteWake?: () => boolean
  readonly schedule: (run: () => void, ms: number) => () => void
  readonly onEvent?: (event: CarrierEvent) => void
}

export type Carrier = {
  readonly wake: (durableId: string) => Promise<CarrierWakeOutcome>
  readonly evaluate: (durableId: string) => Promise<CarrierEvaluation>
  /** Starts requested rows that are due and takes over rows whose lease ran out (A3.1.3). */
  readonly sweep: () => Promise<void>
  readonly stop: () => Promise<void>
}

type Carried = {
  readonly durableId: string
  readonly connection: CarrierHostConnection
  readonly sessionId: string
  generation: number
  readonly off: () => void
}

const HELD_ELSEWHERE = new Set(["session_held", "session_path_in_use"])
const DEFINITIVE = new Set(["invalid_path", "unknown_session"])

function codeOf(frame: RpcObject): string {
  if (typeof frame.errorCode === "string") return frame.errorCode
  return typeof frame.error === "string" ? (frame.error.split(":")[0] ?? frame.error).trim() : "unknown"
}

function dataOf(frame: RpcObject): Record<string, unknown> {
  const data = frame.data
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {}
}

function busyList(frame: RpcObject): readonly string[] {
  const busy = (frame.errorData as { readonly busy?: unknown } | undefined)?.busy
  return Array.isArray(busy) ? busy.map(String) : []
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return -1
  }
}

/**
 * The carrier of woken sessions in one engine process (#13037 A3.1.3-A3.1.8, A3.2). Each carried session has its own kept
 * connection, the session's only attachment from this process. It lifts the opening gate and sends the engine's `wake`;
 * when the session is finished it hands it back with a quiet `release_session { reason: "takeover" }` and never sends
 * that release while background work is pending. A person's attached client takes the session over. A wait for a person
 * that arose after admission is closed after 30 minutes. A held session is not run, its state is stored, and it is not
 * woken again until its file changes.
 */
export function createCarrier(options: CarrierOptions): Carrier {
  const { store } = options
  const carried = new Map<string, Carried>()
  const chains = new Map<string, Promise<unknown>>()
  const emit = options.onEvent ?? (() => undefined)
  let stopped = false
  let cancelTimer: (() => void) | undefined

  const serial = <T>(durableId: string, work: () => Promise<T>): Promise<T> => {
    const previous = chains.get(durableId) ?? Promise.resolve()
    const next = previous.then(work, work)
    chains.set(
      durableId,
      next.catch(() => undefined),
    )
    return next
  }

  const forget = (entry: Carried): void => {
    entry.off()
    entry.connection.close()
    carried.delete(entry.durableId)
  }

  const releaseOwn = async (entry: Carried): Promise<void> => {
    await entry.connection.request({ type: "release_attachment", sessionId: entry.sessionId }).catch(() => undefined)
  }

  const recordHeld = async (durableId: string, sessionFile: string, view: EngineView): Promise<void> => {
    await store.sessionWait.write({
      durable_id: durableId,
      wait: "held",
      hold_kinds: view.holdKinds.length > 0 ? view.holdKinds : ["paused"],
      file_size: fileSize(sessionFile),
    })
  }

  /** The quiet hand-back (A3.2.4): a refusal naming a held delivery is retried once with interrupt, which drops it. */
  const quietRelease = async (
    entry: Carried,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly code: string }> => {
    const first = await entry.connection.request({
      type: "release_session",
      sessionId: entry.sessionId,
      reason: "takeover",
    })
    if (first.success === true) return { ok: true }
    if (codeOf(first) === "turn_active" && busyList(first).includes("delivery")) {
      const second = await entry.connection.request({
        type: "release_session",
        sessionId: entry.sessionId,
        reason: "takeover",
        interrupt: true,
      })
      if (second.success === true) return { ok: true }
      return { ok: false, code: codeOf(second) }
    }
    return { ok: false, code: codeOf(first) }
  }

  const attachedOthers = async (entry: Carried): Promise<boolean> => {
    const listed = await entry.connection.request({ type: "list_sessions", observe: true })
    const sessions = dataOf(listed).sessions
    if (!Array.isArray(sessions)) return false
    const row = sessions.find(
      (session) => (session as { readonly sessionId?: unknown }).sessionId === entry.sessionId,
    ) as { readonly attachments?: unknown } | undefined
    return Number(row?.attachments ?? 0) > 1
  }

  const evaluateNow = async (durableId: string): Promise<CarrierEvaluation> => {
    const entry = carried.get(durableId)
    if (entry === undefined) return { kind: "not_carried" }
    const renewed = await store.woken.renew({ durable_id: durableId, generation: entry.generation })
    if (renewed.kind === "lost_lease") {
      await releaseOwn(entry)
      forget(entry)
      return { kind: "lost_lease" }
    }
    const fence = { durable_id: durableId, generation: entry.generation }
    if (await attachedOthers(entry)) {
      await releaseOwn(entry)
      await store.woken.end(fence)
      await store.woken.resetCount({ durable_id: durableId })
      forget(entry)
      return { kind: "handed_over" }
    }
    const state = await entry.connection.request({ type: "get_state", sessionId: entry.sessionId })
    const view = readEngineState(dataOf(state))
    if (view.held) {
      await quietRelease(entry)
      await recordHeld(durableId, renewed.row.session_file, view)
      await store.woken.end(fence)
      forget(entry)
      return { kind: "held" }
    }
    if (view.waitingForPerson) {
      const recorded = await store.woken.recordWaiting(fence)
      if (recorded.kind === "lost_lease") return { kind: "lost_lease" }
      const since = recorded.row.first_waiting_at ?? store.now()
      if (store.now() - since < PERSON_WAIT_CLOSE_MS) return { kind: "waiting", since }
      const fresh = readEngineState(
        dataOf(await entry.connection.request({ type: "get_state", sessionId: entry.sessionId })),
      )
      if (!fresh.waitingForPerson) return { kind: "kept", reason: "working" }
      await entry.connection.request({ type: "close_session", sessionId: entry.sessionId })
      await store.woken.end(fence)
      forget(entry)
      return { kind: "closed_waiting" }
    }
    if (renewed.row.first_waiting_at !== null) await store.woken.clearWaiting(fence)
    if (!view.finished) return { kind: "kept", reason: "working" }
    const released = await quietRelease(entry)
    if (!released.ok) {
      if (released.code === "turn_active" || released.code === "session_busy")
        return { kind: "kept", reason: "working" }
      if (released.code === "attached") {
        await releaseOwn(entry)
        await store.woken.end(fence)
        await store.woken.resetCount({ durable_id: durableId })
        forget(entry)
        return { kind: "handed_over" }
      }
      await store.woken.end(fence)
      forget(entry)
      return { kind: "close_failed", code: released.code }
    }
    await entry.connection.request({ type: "detach_connection" }).catch(() => undefined)
    await store.woken.end(fence)
    forget(entry)
    return { kind: "released" }
  }

  const evaluate = (durableId: string): Promise<CarrierEvaluation> =>
    serial(durableId, async () => {
      const outcome = await evaluateNow(durableId)
      emit({ kind: "evaluated", durable_id: durableId, outcome })
      return outcome
    })

  const carry = (durableId: string, connection: CarrierHostConnection, sessionId: string, generation: number) => {
    const off = connection.onEvent((frame) => {
      if (frame.type === "session_lifecycle" && frame.sessionId === sessionId)
        void evaluate(durableId).catch(() => undefined)
    })
    const entry: Carried = { durableId, connection, sessionId, generation, off }
    carried.set(durableId, entry)
    void connection.closed.then(() => {
      if (carried.get(durableId) === entry) carried.delete(durableId)
    })
    return entry
  }

  const open = async (
    path: string,
    cwd: string,
  ): Promise<
    | {
        readonly kind: "opened"
        readonly connection: CarrierHostConnection
        readonly sessionId: string
        readonly attached: boolean
        readonly view: EngineView
      }
    | { readonly kind: "refused"; readonly code: string }
    | { readonly kind: "unreachable" }
  > => {
    let connection: CarrierHostConnection
    try {
      await options.ensureHost()
      connection = await options.connect()
    } catch {
      return { kind: "unreachable" }
    }
    const reply = await connection
      .request({ type: "open_session", sessionPath: path, cwd, retain_on_disconnect: true })
      .catch(() => undefined)
    if (reply === undefined) {
      connection.close()
      return { kind: "unreachable" }
    }
    if (reply.success !== true) {
      connection.close()
      return { kind: "refused", code: codeOf(reply) }
    }
    const data = dataOf(reply)
    return {
      kind: "opened",
      connection,
      sessionId: String(data.sessionId),
      attached: data.attached === true,
      view: readEngineState(data.state),
    }
  }

  const wakeNow = async (durableId: string): Promise<CarrierWakeOutcome> => {
    if (carried.has(durableId)) {
      const entry = carried.get(durableId)
      return { kind: "open", session_id: entry?.sessionId ?? "", generation: entry?.generation ?? 0 }
    }
    const target = resolveWakeTarget(options.sessionsDirectory, durableId)
    if (target.kind === "gone" || target.kind === "ambiguous") return target
    if (target.session_kind !== "interactive") return { kind: "not_wakeable", session_kind: target.session_kind }
    const wait = await store.sessionWait.read({ durable_id: durableId })
    if (wait?.wait === "held" && wait.file_size === fileSize(target.session_path)) return { kind: "held" }
    const allowance = await openAllowance(durableId, target.cwd)
    if (allowance !== "open") {
      if (allowance === "nothing_queued") {
        // Only a record that is still `requested` is ended, compared on its generation: another carrier's record that
        // is being opened or is open keeps its lease, so that carrier still closes the session it carries.
        const record = (await store.woken.list()).find((row) => row.durable_id === durableId)
        if (record === undefined) return { kind: "nothing_queued" }
        if (record.state !== "requested") return { kind: "busy", code: "wake_in_progress" }
        const ended = await store.woken.end({ durable_id: durableId, generation: record.generation })
        return ended.kind === "ended" ? { kind: "nothing_queued" } : { kind: "busy", code: "wake_in_progress" }
      }
      await store.woken.request({ durable_id: durableId, session_file: target.session_path })
      return { kind: "switched_off" }
    }
    const limit = options.wakeLimit?.() ?? 0
    if (limit > 0 && (await store.woken.wakeCount({ durable_id: durableId })) >= limit)
      return { kind: "wake_limit_reached" }

    await store.woken.request({ durable_id: durableId, session_file: target.session_path })
    const started = await store.woken.start({ durable_id: durableId })
    if (started.kind === "overloaded" || started.kind === "not_yet") return started
    if (started.kind !== "started") return { kind: "busy", code: "wake_in_progress" }
    const fence = { durable_id: durableId, generation: started.row.generation }

    const opened = await open(target.session_path, target.cwd)
    if (opened.kind !== "opened") {
      if (opened.kind === "refused" && (HELD_ELSEWHERE.has(opened.code) || DEFINITIVE.has(opened.code))) {
        await store.woken.end(fence)
        return DEFINITIVE.has(opened.code) ? { kind: "gone" } : { kind: "busy", code: opened.code }
      }
      const retry = await store.woken.retryLater(fence)
      if (retry.kind === "failed") return { kind: "failed", attempts: retry.attempts }
      if (retry.kind === "lost_lease") return { kind: "busy", code: "wake_in_progress" }
      return { kind: "deferred", attempts: retry.row.attempts }
    }
    const entry = carry(durableId, opened.connection, opened.sessionId, started.row.generation)
    if (opened.view.held) {
      if (opened.attached) await releaseOwn(entry)
      else await quietRelease(entry)
      await recordHeld(durableId, target.session_path, opened.view)
      await store.woken.end(fence)
      forget(entry)
      return { kind: "held" }
    }
    if (opened.view.waitingForPerson) {
      await store.sessionWait.write({
        durable_id: durableId,
        wait: "waiting",
        hold_kinds: [],
        file_size: fileSize(target.session_path),
      })
      await releaseOwn(entry)
      await store.woken.end(fence)
      forget(entry)
      return { kind: "waiting" }
    }
    await store.sessionWait.clear({ durable_id: durableId })
    await store.woken.countWake({ durable_id: durableId, human_input_revision: opened.view.humanInputRevision })
    const lifted = await store.woken.setState({ ...fence, state: "open" })
    if (lifted.kind === "lost_lease") {
      await releaseOwn(entry)
      forget(entry)
      return { kind: "busy", code: "wake_in_progress" }
    }
    await entry.connection.request({ type: "wake", sessionId: entry.sessionId }).catch(() => undefined)
    return { kind: "open", session_id: entry.sessionId, generation: entry.generation }
  }

  const takeOver = async (durableId: string): Promise<void> => {
    const taken = await store.woken.takeOver({ durable_id: durableId })
    if (taken.kind !== "taken_over") return
    const target = resolveWakeTarget(options.sessionsDirectory, durableId)
    // The same refusals a wake makes: a session that is gone, ambiguous, or no longer interactive is not reopened.
    if (target.kind !== "found" || target.session_kind !== "interactive") {
      await store.woken.end({ durable_id: durableId, generation: taken.row.generation })
      return
    }
    const opened = await open(target.session_path, target.cwd)
    if (opened.kind !== "opened") return
    carry(durableId, opened.connection, opened.sessionId, taken.row.generation)
    // Already inside this session's serial chain: evaluate directly, never through `evaluate`, which would wait on itself.
    const outcome = await evaluateNow(durableId)
    emit({ kind: "evaluated", durable_id: durableId, outcome })
  }

  /**
   * The one rule of A7.2.3 (A7R-10), the reviewer's LOW and A7's row-from-another-device rule in one place: a carrier
   * opens a session only when the session holds a queued row whose own switch allows the open. A row from another
   * device (it carries the intake's ledger id) reads the wake the consumer was told; a same-device row reads
   * `session_wake.same_device` for the TARGET session's cwd. Both are read here, at the moment of the open.
   */
  const openAllowance = async (durableId: string, cwd: string): Promise<"open" | "switched_off" | "nothing_queued"> => {
    const sameDevice = options.sameDevice?.(cwd) ?? false
    const remoteWake = options.remoteWake?.() ?? false
    let queued = false
    for (const row of await store.list({ target_durable_id: durableId })) {
      if (row.state !== "queued") continue
      queued = true
      if (typeof row.ledger_id === "string" ? remoteWake : sameDevice) return "open"
    }
    return queued ? "switched_off" : "nothing_queued"
  }

  const sweep = async (): Promise<void> => {
    await sweepNow()
  }

  /** Whether the timer still has work to tend: a woken row or a carried session (A3.1.4). */
  const sweepNow = async (): Promise<boolean> => {
    if (stopped) return false
    const now = store.now()
    const rows = await store.woken.list()
    for (const row of rows) {
      if (carried.has(row.durable_id)) {
        await evaluate(row.durable_id).catch(() => undefined)
        continue
      }
      if (row.state === "requested") {
        if (row.next_attempt_at === null || row.next_attempt_at <= now)
          await serial(row.durable_id, () => wakeNow(row.durable_id)).catch(() => undefined)
        continue
      }
      if (row.lease_expires_at !== null && row.lease_expires_at <= now)
        await serial(row.durable_id, () => takeOver(row.durable_id)).catch(() => undefined)
    }
    return rows.length > 0 || carried.size > 0
  }

  let timerArmed = false
  const arm = (): void => {
    if (stopped || timerArmed) return
    timerArmed = true
    cancelTimer = options.schedule(
      () => {
        timerArmed = false
        void sweepNow().then(
          (hasWork) => {
            if (hasWork) arm()
          },
          // A sweep that threw still had work to tend: the timer stays armed for the next tick (A3.1.4).
          () => arm(),
        )
      },
      Math.min(CARRIER_RENEW_MS, WAKE_LEASE_MS / 3),
    )
  }

  // A3.1.4: every carrier runs a sweep when it starts, so rows a dead process left requested and leases that ran
  // out are taken over by the successor without a wake of its own. With an empty table there is no timer: the one
  // read that decided that arms nothing (#13455's delta review).
  void store.woken
    .list()
    .then((rows) => {
      if (rows.length > 0)
        void sweepNow()
          .then((hasWork) => {
            if (hasWork) arm()
          })
          .catch(() => undefined)
    })
    .catch(() => undefined)

  return {
    wake: (durableId) =>
      serial(durableId, async () => {
        // A wake leaves a row the timer must tend (a retry, a carried session's lease); an empty table disarms it again.
        arm()
        return await wakeNow(durableId)
      }),
    evaluate,
    sweep,
    stop: async () => {
      stopped = true
      cancelTimer?.()
      await Promise.allSettled([...chains.values()])
      for (const entry of [...carried.values()]) forget(entry)
    },
  }
}
