import { outcomeOf } from "../thread/remote/outcome"
import { eventStream, openAttachment } from "./attach"
import type { RemoteClient } from "./client"
import { nextActionFor, remoteFailure } from "./codes"
import { type ClientCore, ok } from "./core"
import { DEADLINES } from "./deadlines"
import { canonicalizeThreadHandle } from "./seams"
import type {
  AttachEvent,
  AttachHandle,
  FollowEvent,
  FollowOutcome,
  JsonObject,
  Opts,
  PendingRequest,
  R,
  RemoteFailure,
  SnapshotBody,
  ThreadHandle,
  WaitResult,
} from "./types"

type StreamMembers = Pick<RemoteClient["sessions"], "follow" | "wait">

type WatchHandlers = {
  readonly event: (event: AttachEvent) => void
  /** A later snapshot: the attach was re-established after a gap, and this is the session now. */
  readonly snapshot: (snapshot: SnapshotBody) => void
  /** A fresh `get_state` of the session's engine: read once at the start and again after each later snapshot. */
  readonly fresh: (state: JsonObject) => void
  /** The attach's events ended (after `session_closed` when the session closed). */
  readonly ended: () => void
}
type SessionWatch = {
  readonly initial: SnapshotBody
  readonly handle: AttachHandle
  /** The first fresh read, started once the caller can take it; settles once it was delivered to `fresh` or told nothing. */
  readonly baseline: () => Promise<void>
  readonly stop: () => void
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

/**
 * The ONE place follow and wait take a session's events: today the attach this module opens (attach.ts), which ends at a
 * relay, service or engine restart, plus one fresh `get_state` at the start and after each re-attach, since a snapshot's
 * `isStreaming` can be stale while a turn runs. rt-monitor-wait's attach pool and watch v2 (feat/remote-session-wait)
 * re-attach and resync across restarts with the same baseline read; switching to it replaces only this function.
 */
async function watchSession(
  core: ClientCore,
  thread: ThreadHandle,
  signal: AbortSignal | undefined,
  handlers: WatchHandlers,
): R<SessionWatch> {
  const opened = await openAttachment(core, thread, signal === undefined ? undefined : { signal })
  if (opened.kind === "error") return opened
  const { handle, onSnapshot } = opened.value
  const parsed = canonicalizeThreadHandle(thread, {})
  const target = parsed.kind === "ok" ? parsed.value.target : undefined
  const record: JsonObject =
    target?.kind === "device_session" ? { type: "get_state", sessionId: target.session } : { type: "get_state" }
  let stopped = false
  // A read that fails, or that the host answers without the engine's reply, tells nothing; the records still do.
  const readFresh = async (): Promise<void> => {
    const sent = await handle.command(record)
    if (stopped || sent.kind === "error") return
    const outcome = outcomeOf(sent.value)
    const data = outcome.kind === "ok" ? outcome.response["data"] : undefined
    if (isObject(data)) handlers.fresh(data)
  }
  const stopSnapshots = onSnapshot((snapshot) => {
    if (stopped) return
    handlers.snapshot(snapshot)
    void readFresh()
  })
  void (async () => {
    for await (const event of handle.events) if (!stopped) handlers.event(event)
    if (!stopped) handlers.ended()
  })()
  return ok({
    initial: handle.snapshot,
    handle,
    baseline: readFresh,
    stop: () => {
      stopped = true
      stopSnapshots()
      void handle.detach()
    },
  })
}

// Lifted from rt-monitor-wait (feat/remote-session-wait, thread/remote/session-state.ts `sessionStateOf` and `statusOf`),
// with one rule added for the live relay bug of #13753: a snapshot or a get_state can claim idle while a turn runs (the
// engine's in-memory state changes with no record on the attach), so `isStreaming: false` never ends a run. A run ends
// only on an observed end: `agent_settled`, a `session_status` idle, or senpi's run lease (the `session-lifecycle`
// record its lifecycle ledger appends at each change, seen as `session_lifecycle` records, as transcript entries and as
// get_state's `lifecycle`) moving to a state other than running.
type Lease = { readonly state: string; readonly seq: number }
/** An engine state as any layer hands it over (a snapshot's, an attach command's or the thread port's get_state reply). */
type EngineState = { readonly [field: string]: unknown }

const leaseOf = (value: unknown): Lease | undefined =>
  isObject(value) && typeof value["state"] === "string" && typeof value["seq"] === "number"
    ? { state: value["state"], seq: value["seq"] }
    : undefined

const newer = (a: Lease | undefined, b: Lease | undefined): Lease | undefined =>
  a === undefined || (b !== undefined && b.seq > a.seq) ? b : a

/** The newest run lease among transcript entries (`custom` entries of type `session-lifecycle`). */
const newestLease = (entries: readonly unknown[]): Lease | undefined =>
  entries.reduce<Lease | undefined>(
    (newest, entry) =>
      newer(
        newest,
        isObject(entry) && entry["customType"] === "session-lifecycle" ? leaseOf(entry["data"]) : undefined,
      ),
    undefined,
  )

type Signal =
  | { readonly kind: "status"; readonly status: string }
  /** The run this tracker saw in flight ended, observed. */
  | { readonly kind: "run_ended" }
  | { readonly kind: "text"; readonly delta: string }
  | { readonly kind: "tool"; readonly event: ToolEvent }
  | { readonly kind: "frame"; readonly request: PendingRequest }
  | { readonly kind: "unobservable"; readonly device: string }
type ToolEvent = Extract<FollowEvent, { readonly tool_call_id: string }>

const TOOL_KINDS = {
  tool_execution_start: "tool_start",
  tool_execution_update: "tool_update",
  tool_execution_end: "tool_end",
} as const

const toolEvent = (record: JsonObject): Signal | undefined => {
  const type = record["type"]
  if (type !== "tool_execution_start" && type !== "tool_execution_update" && type !== "tool_execution_end")
    return undefined
  const result = type === "tool_execution_end" ? record["result"] : record["partialResult"]
  return {
    kind: "tool",
    event: {
      kind: TOOL_KINDS[type],
      tool_call_id: String(record["toolCallId"] ?? ""),
      name: String(record["toolName"] ?? ""),
      ...(type === "tool_execution_start" && record["args"] !== undefined ? { args: record["args"] } : {}),
      ...(type !== "tool_execution_start" && result !== undefined ? { result } : {}),
      ...(type === "tool_execution_end" ? { is_error: record["isError"] === true } : {}),
    },
  }
}

/** One session's status and its current turn, moved by the attach's events; what follow and wait both read. */
class SessionTurn {
  status = "idle"
  /** A run is in flight: a source showed it running and no end was observed since. Only `#end` clears it. */
  running = false
  /** A run was seen in flight since the follow or wait started. */
  ran = false
  text = ""
  turnId: string | undefined
  aborted = false
  #leaseSeq = -1

  /** What an attach event changes, in order; `closed` once the session left its engine. */
  apply(event: AttachEvent): readonly Signal[] | "closed" {
    switch (event.kind) {
      case "record":
        return this.#record(event.record)
      case "frame":
        return [{ kind: "frame", request: event.request }, ...this.#show("waiting_input", true)]
      case "frame_settled":
        return []
      case "approvals_unobservable":
        return [{ kind: "unobservable", device: event.device }]
      case "channel_lost":
        return []
      case "session_closed":
        return "closed"
    }
  }

  /** A snapshot (the first, or a re-attach's): what it shows in flight, and its run lease. Its idle alone ends nothing. */
  resync(snapshot: SnapshotBody): readonly Signal[] {
    return this.fresh(isObject(snapshot.state) ? snapshot.state : {}, snapshot.entries)
  }

  /** An engine state (a snapshot's or a fresh get_state's): the same rule as `resync`. */
  fresh(state: EngineState, entries: readonly unknown[] = []): readonly Signal[] {
    const leased = this.#lease(newer(leaseOf(state["lifecycle"]), newestLease(entries)))
    if (leased.length > 0) return leased
    const questions = state["pendingQuestions"]
    const dialogs = state["pendingDialogs"]
    if (state["isCompacting"] === true) return this.#show("compacting")
    if ((Array.isArray(questions) && questions.length > 0) || (Array.isArray(dialogs) && dialogs.length > 0))
      return this.#show("waiting_input")
    return state["isStreaming"] === true ? this.#run() : []
  }

  outcome(): FollowOutcome {
    return {
      reason: this.aborted ? "interrupted" : "settled",
      ...(this.aborted || this.text === "" ? {} : { text: this.text }),
      ...(this.turnId === undefined ? {} : { turn_id: this.turnId }),
    }
  }

  /** A run lease newer than the last one seen: running runs, waiting_human asks, any other state ends the run. */
  #lease(lease: Lease | undefined): readonly Signal[] {
    if (lease === undefined || lease.seq <= this.#leaseSeq) return []
    this.#leaseSeq = lease.seq
    if (lease.state === "running") return this.#run()
    if (lease.state === "waiting_human") return this.#show("waiting_input")
    return this.#end()
  }

  #record(record: JsonObject): readonly Signal[] | "closed" {
    const type = record["type"]
    if (type === "agent_start") {
      this.text = ""
      this.aborted = false
      this.turnId = nonEmpty(record["runId"])
    }
    if (type === "agent_end") this.aborted = record["aborted"] === true
    const moved = this.#moved(record)
    if (moved === "closed") return "closed"
    const update = record["assistantMessageEvent"]
    if (type === "message_update" && isObject(update) && update["type"] === "text_delta") {
      const delta = typeof update["delta"] === "string" ? update["delta"] : ""
      this.text += delta
      return [...moved, { kind: "text", delta }]
    }
    const tool = toolEvent(record)
    return tool === undefined ? moved : [...moved, tool]
  }

  #moved(record: JsonObject): readonly Signal[] | "closed" {
    switch (record["type"]) {
      case "agent_start":
        return this.#run()
      case "agent_settled":
        return this.#end()
      case "session_lifecycle":
        return this.#lease(leaseOf(record["lifecycle"]))
      case "entry_appended":
        return this.#lease(newestLease([record["entry"]]))
      case "session_status": {
        const status = nonEmpty(record["status"])
        if (status === "closed") return "closed"
        if (status === "running") return this.#run()
        if (status === "idle") return this.#end()
        return status === undefined ? [] : this.#show(status)
      }
      default:
        return []
    }
  }

  #run(): readonly Signal[] {
    this.running = true
    this.ran = true
    return this.#show("running")
  }

  /** An observed end of the run: the only way `running` goes false. */
  #end(): readonly Signal[] {
    const was = this.running
    this.running = false
    if (was) {
      this.status = "idle"
      return [{ kind: "run_ended" }]
    }
    return this.#show("idle")
  }

  #show(status: string, always = false): readonly Signal[] {
    if (status === this.status && !always) return []
    this.status = status
    return [{ kind: "status", status }]
  }
}

/**
 * One engine state as `sessions.get` reports it, by the rule follow and wait apply (#13753): `running` when the state
 * shows a run in flight (`isStreaming`, or a run lease, `state.lifecycle` or the newest `session-lifecycle` entry among
 * `entries`, still running); `waiting_input` when it asks a person; `compacting`; else `idle`. A stale `isStreaming:
 * false` cannot hide a run the lease still holds. Read it from a fresh `get_state` (pass a snapshot's entries too when
 * there is one), never from a held reply.
 */
export function sessionStatusOf(state: EngineState, entries: readonly unknown[] = []): string {
  const turn = new SessionTurn()
  turn.fresh(state, entries)
  return turn.status
}

const WAITING: Readonly<Record<string, Extract<FollowEvent, { readonly kind: "waiting" }>["state"]>> = {
  running: "turn_running",
  idle: "idle",
  waiting_input: "awaiting_approval",
  compacting: "compacting",
  opening: "queued",
}

const ANSWER_ELSEWHERE = "A person answers it with attach(thread).answer on a person client."

const attachEnded = (): RemoteFailure =>
  remoteFailure(
    "host_unavailable",
    "The session's attach ended before its turn did.",
    "Call sessions.get for the session's state, then sessions.follow again.",
  )

/**
 * The stream members of part 4a-2 (unit U2 of #13414): follow (the turn's stream, its states and its end) and wait,
 * both on the attach's events (`watchSession`), never a poll of read.
 */
export function streamMembers(core: ClientCore): StreamMembers {
  const person = core.sender.kind === "person"

  const follow = (thread: ThreadHandle, opts?: Opts) => {
    let watch: SessionWatch | undefined
    let finished = false
    const deadlineMs = opts?.deadlineMs ?? DEADLINES.followTotal
    const output = eventStream<FollowEvent>({ onStop: () => finish() })
    const finish = (last?: FollowEvent): void => {
      if (finished) return
      finished = true
      if (last !== undefined) output.push(last)
      output.end()
      cancelTimer()
      opts?.signal?.removeEventListener("abort", onAbort)
      watch?.stop()
    }
    const fail = (failure: RemoteFailure): void => finish({ kind: "failed", failure })
    const onAbort = (): void =>
      fail(remoteFailure("cancelled", "The follow was cancelled.", nextActionFor("cancelled")))
    const cancelTimer = core.timers.after(deadlineMs, () =>
      fail(
        remoteFailure("timeout", `The turn did not end within ${deadlineMs} ms.`, nextActionFor("timeout"), {
          details: { deadline_ms: deadlineMs },
        }),
      ),
    )
    if (opts?.signal?.aborted === true) onAbort()
    opts?.signal?.addEventListener("abort", onAbort, { once: true })

    let turn: SessionTurn | undefined
    const waiting = (status: string): FollowEvent | undefined => {
      const state = WAITING[status]
      if (state === undefined) return undefined
      if (state !== "awaiting_approval") return { kind: "waiting", state }
      const pending = watch?.handle.pending() ?? []
      return person
        ? { kind: "waiting", state, pending }
        : {
            kind: "waiting",
            state,
            pending_redacted: { count: pending.length, kinds: pending.map((request) => request.kind) },
            next_action: ANSWER_ELSEWHERE,
          }
    }
    const deliver = (signals: readonly Signal[] | "closed"): void => {
      if (turn === undefined || finished) return
      if (signals === "closed") return finish({ kind: "end", outcome: { reason: "session_closed" } })
      for (const signal of signals) {
        if (signal.kind === "run_ended") return finish({ kind: "end", outcome: turn.outcome() })
        if (signal.kind === "status") {
          const event = waiting(signal.status)
          if (event !== undefined) output.push(event)
        } else if (signal.kind === "text") output.push({ kind: "text", delta: signal.delta })
        else if (signal.kind === "tool") output.push(signal.event)
        else if (signal.kind === "frame") {
          if (person) output.push({ kind: "frame", request: signal.request })
        } else output.push({ kind: "approvals_unobservable", device: signal.device })
      }
    }

    void watchSession(core, thread, opts?.signal, {
      event: (event) => deliver(turn?.apply(event) ?? []),
      snapshot: (snapshot) => deliver(turn?.resync(snapshot) ?? []),
      fresh: (state) => deliver(turn?.fresh(state) ?? []),
      ended: () => fail(attachEnded()),
    }).then((opened) => {
      if (opened.kind === "error") return fail(opened)
      watch = opened.value
      if (finished) return watch.stop()
      turn = new SessionTurn()
      turn.resync(opened.value.initial)
      if (person) for (const request of watch.handle.pending()) output.push({ kind: "frame", request })
      const first = waiting(turn.status)
      if (first !== undefined) output.push(first)
      void watch.baseline()
    })
    return output.stream
  }

  const wait = (thread: ThreadHandle, opts?: Opts): R<WaitResult> => {
    const start = core.timers.now()
    return new Promise((resolve) => {
      let watch: SessionWatch | undefined
      let turn: SessionTurn | undefined
      // "No run" is believed only once the fresh read came back: the snapshot's idle can be stale (#13753).
      let confirmed = false
      let settled = false
      const done = (outcome: Awaited<R<WaitResult>>): void => {
        if (settled) return
        settled = true
        cancelTimer()
        opts?.signal?.removeEventListener("abort", onAbort)
        watch?.stop()
        resolve(outcome)
      }
      const result = (outcome: WaitResult["outcome"], status = turn?.status ?? "unknown"): void =>
        done(ok({ outcome, status, waited_ms: core.timers.now() - start }))
      const onAbort = (): void => result("cancelled")
      const cancelTimer = core.timers.after(opts?.deadlineMs ?? DEADLINES.followTotal, () => result("timeout"))
      if (opts?.signal?.aborted === true) return onAbort()
      opts?.signal?.addEventListener("abort", onAbort, { once: true })
      // Settled: the session waits on a person's answer, or holds no run. A run it was seen holding ends only on an
      // observed end (a record or the run lease), never on an idle snapshot or get_state.
      const check = (signals: readonly Signal[] | "closed"): void => {
        if (signals === "closed") return result("ended", "closed")
        if (turn === undefined) return
        if (turn.status === "waiting_input") return result("settled")
        if (!turn.running && (confirmed || signals.some((signal) => signal.kind === "run_ended"))) result("settled")
      }
      void watchSession(core, thread, opts?.signal, {
        event: (event) => check(turn?.apply(event) ?? []),
        snapshot: (snapshot) => check(turn?.resync(snapshot) ?? []),
        fresh: (state) => check(turn?.fresh(state) ?? []),
        ended: () => done(attachEnded()),
      }).then(async (opened) => {
        if (opened.kind === "error") return done(opened)
        watch = opened.value
        if (settled) return watch.stop()
        turn = new SessionTurn()
        turn.resync(opened.value.initial)
        check([])
        await opened.value.baseline()
        confirmed = true
        check([])
      })
    })
  }

  return { follow, wait }
}
