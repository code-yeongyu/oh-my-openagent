import { outcomeOf } from "../thread/remote/outcome"
import { eventStream, openAttachment, pendingRequestOf, raiserOnly } from "./attach"
import { type ClientCore, ok, type RemoteClient } from "./client"
import { engineCode, nextActionFor, remoteFailure } from "./codes"
import { DEADLINES } from "./deadlines"
import { canonicalizeThreadHandle } from "./seams"
import type {
  AttachEvent,
  AttachHandle,
  FollowEvent,
  FollowOpts,
  FollowOutcome,
  JsonObject,
  Opts,
  PendingRequest,
  R,
  RemoteFailure,
  SendReceipt,
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
  /**
   * The first fresh read, started once the caller can take it: undefined once a state was delivered to `fresh`, else
   * why none was (the read failed, ended uncertain, or the host sent no engine reply).
   */
  readonly baseline: () => Promise<RemoteFailure | undefined>
  /** Delivers what arrived since the open (the attach's replay first), then everything as it arrives. */
  readonly start: () => void
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
  // A read that fails, or that the host answers without the engine's reply, delivers nothing and says why; the records
  // still flow either way.
  const readFresh = async (): Promise<RemoteFailure | undefined> => {
    const sent = await handle.command(record)
    if (sent.kind === "error") return sent
    const outcome = outcomeOf(sent.value)
    if (outcome.kind === "uncertain")
      return remoteFailure("unconfirmed", `get_state ended uncertain: ${outcome.reason}.`, RETRY_WAIT, {
        details: { reason: outcome.reason },
      })
    if (outcome.kind === "refused") {
      const mapped = engineCode(outcome.reason)
      return remoteFailure(mapped.code, `The engine refused get_state: ${outcome.reason}.`, RETRY_WAIT, {
        ...(mapped.details === undefined ? {} : { details: mapped.details }),
      })
    }
    const data = outcome.response["data"]
    if (!isObject(data))
      return remoteFailure("unsupported", "The session's host sent no engine reply to get_state.", RETRY_WAIT, {
        details: { feature: "fresh_state" },
      })
    if (!stopped) handlers.fresh(data)
    return undefined
  }
  // Nothing reaches the handlers before the caller is ready for it (start): the attach replays its records the moment it
  // opens, and a record dropped there could be the very turn a follow waits for.
  type Arrival =
    | { readonly kind: "event"; readonly event: AttachEvent }
    | { readonly kind: "snapshot"; readonly snapshot: SnapshotBody }
    | { readonly kind: "ended" }
  let early: Arrival[] | undefined = []
  const arrive = (arrival: Arrival): void => {
    if (stopped) return
    if (early !== undefined) return void early.push(arrival)
    if (arrival.kind === "event") handlers.event(arrival.event)
    else if (arrival.kind === "ended") handlers.ended()
    else {
      handlers.snapshot(arrival.snapshot)
      void readFresh()
    }
  }
  const stopSnapshots = onSnapshot((snapshot) => arrive({ kind: "snapshot", snapshot }))
  void (async () => {
    for await (const event of handle.events) arrive({ kind: "event", event })
    arrive({ kind: "ended" })
  })()
  return ok({
    initial: handle.snapshot,
    handle,
    baseline: readFresh,
    start: () => {
      const arrived = early ?? []
      early = undefined
      for (const arrival of arrived) arrive(arrival)
    },
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
type Lease = { readonly state: string; readonly seq: number; readonly runId?: string }

const leaseOf = (value: unknown): Lease | undefined =>
  isObject(value) && typeof value["state"] === "string" && typeof value["seq"] === "number"
    ? {
        state: value["state"],
        seq: value["seq"],
        ...(nonEmpty(value["runId"]) === undefined ? {} : { runId: String(value["runId"]) }),
      }
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

/** The newest run lease a snapshot holds: its state's `lifecycle`, or its newest `session-lifecycle` entry. */
const snapshotLease = (snapshot: SnapshotBody): Lease | undefined =>
  newer(leaseOf(isObject(snapshot.state) ? snapshot.state["lifecycle"] : undefined), newestLease(snapshot.entries))

/** The run lease a record carries: a `session_lifecycle` record, or an appended `session-lifecycle` entry. */
const recordLease = (record: JsonObject): Lease | undefined =>
  record["type"] === "session_lifecycle"
    ? leaseOf(record["lifecycle"])
    : record["type"] === "entry_appended"
      ? newestLease([record["entry"]])
      : undefined

/**
 * follow's anchor (#13753): it follows from the moment it opens. The attach replays turns that already ran (the host
 * streams records it buffered since an older snapshot), so everything the attach replays or the snapshot holds is
 * history, and history never reaches the turn: no text, no tool event, no end. The anchor is the run lease the session
 * held when follow opened (its first fresh get_state, the baseline). A run is this follow's when:
 * - a lease newer than the baseline shows it running;
 * - it is the run in flight at the baseline (a caller may open follow and send without waiting for the open); or
 * - the baseline shows it ended, under a newer lease than the snapshot's and with another run id than the snapshot's
 *   (it started after the open and ended before the baseline answered).
 * Until the baseline is known every record waits; a run's records wait until one of these decides them, and a run that
 * settles undecided was history. Without a fresh state the snapshot's lease is the baseline; an engine whose state
 * carries no lease is followed as before.
 */
class FollowAnchor {
  #known = false
  #unanchored = false
  #seq = -1
  readonly #live = new Set<string>()
  readonly #early: AttachEvent[] = []
  /** The newest run lease the snapshot held when follow opened; undefined when it held none. */
  readonly #atOpen: Lease | undefined
  #run: { readonly id: string | undefined; verdict: "live" | "undecided"; readonly held: AttachEvent[] } | undefined

  constructor(atOpen: Lease | undefined) {
    this.#atOpen = atOpen
  }

  /** The lease the session held at the open (undefined: none known); answers the events it releases. */
  baseline(lease: Lease | undefined): readonly AttachEvent[] {
    if (this.#known) return []
    this.#known = true
    if (lease === undefined) this.#unanchored = true
    else {
      this.#seq = lease.seq
      // A run in flight at the baseline is this follow's: the read can land after the send it follows started its run
      // (a caller opens follow and sends without waiting for the open), and nothing tells that run from an older one.
      if (lease.state === "running") {
        if (lease.runId !== undefined) this.#live.add(lease.runId)
        this.#run = { id: lease.runId, verdict: "live", held: [] }
      } else if (
        lease.runId !== undefined &&
        this.#atOpen !== undefined &&
        lease.seq > this.#atOpen.seq &&
        lease.runId !== this.#atOpen.runId
      )
        // A run that started after follow opened (another run than the snapshot's, under a newer lease) and ended before
        // the baseline read answered (it failed at once): it is this follow's, though its own leases are not newer than
        // the baseline. The seq alone proves nothing: it also advances with no new run, and an idle lease keeps the
        // previous run's id (senpi rpc.md "Session lifecycle").
        this.#live.add(lease.runId)
    }
    return this.#early.splice(0).flatMap((event) => this.#accept(event))
  }

  /** The events of `event` that are this follow's, now (held ones included once decided). */
  accept(event: AttachEvent): readonly AttachEvent[] {
    // Only records can be history; a frame, a lost channel or the session's end are this follow's at once.
    if (event.kind !== "record") return [event]
    if (!this.#known) {
      this.#early.push(event)
      return []
    }
    return this.#accept(event)
  }

  #accept(event: AttachEvent): readonly AttachEvent[] {
    if (this.#unanchored || event.kind !== "record") return [event]
    const record = event.record
    const lease = recordLease(record)
    if (lease !== undefined) {
      if (lease.seq <= this.#seq) return []
      const run = this.#run
      if (lease.state === "running" && lease.runId !== undefined) this.#live.add(lease.runId)
      if (run?.verdict === "undecided" && (lease.runId === undefined || lease.runId === run.id)) {
        run.verdict = "live"
        return [...run.held.splice(0), event]
      }
      return [event]
    }
    if (record["type"] === "agent_start") {
      const id = nonEmpty(record["runId"])
      this.#run = { id, verdict: id !== undefined && this.#live.has(id) ? "live" : "undecided", held: [] }
    }
    const run = this.#run
    if (run === undefined) return [event]
    if (record["type"] === "agent_settled") this.#run = undefined
    if (run.verdict === "live") return [event]
    if (run.verdict === "undecided") run.held.push(event)
    return []
  }
}

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

/** A request the session waits on a person for; `raiserOnly` ones are answerable only on the connection that raised them. */
type Asked = { readonly kind: PendingRequest["kind"]; readonly raiserOnly: boolean }

/** One session's status and its current turn, moved by the attach's events; what follow and wait both read. */
class SessionTurn {
  status = "idle"
  /** A run is in flight: a source showed it running and no end was observed since. Only `#end` clears it. */
  running = false
  text = ""
  turnId: string | undefined
  aborted = false
  #leaseSeq = -1
  #compacting = false
  /** The engine (its run lease or its session_status) says it waits on a person, with no request this attach saw. */
  #asksElsewhere = false
  /**
   * An observed run end not yet reported: it arrived while the session still compacted or waited on a request, so it is
   * reported once the status reaches idle. Cleared when a new run starts.
   */
  #endPending = false
  /** The requests the session waits on, shown ones and raiser-only ones alike (#13753 M2). */
  readonly #asked = new Map<string, Asked>()

  /** The requests the session waits on now. */
  asked(): readonly Asked[] {
    return [...this.#asked.values()]
  }

  /** What an attach event changes, in order; `closed` once the session left its engine. */
  apply(event: AttachEvent): readonly Signal[] | "closed" {
    switch (event.kind) {
      case "record":
        return this.#record(event.record)
      case "frame":
        this.#asked.set(event.request.request_id, { kind: event.request.kind, raiserOnly: false })
        return [{ kind: "frame", request: event.request }, ...this.#update(true)]
      case "frame_settled":
        this.#asked.delete(event.request_id)
        return this.#update()
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
  fresh(state: JsonObject, entries: readonly unknown[] = []): readonly Signal[] {
    const dialogs = state["pendingDialogs"]
    const questions = state["pendingQuestions"]
    if (Array.isArray(dialogs) || Array.isArray(questions)) {
      this.#asked.clear()
      for (const request of [
        ...(Array.isArray(dialogs) ? dialogs : []),
        ...(Array.isArray(questions) ? questions : []),
      ])
        this.#ask(request)
    }
    this.#compacting = state["isCompacting"] === true
    const ended = this.#lease(newer(leaseOf(state["lifecycle"]), newestLease(entries)))
    if (state["isStreaming"] === true && !ended) this.#markRunning()
    return this.#update(false, ended)
  }

  outcome(): FollowOutcome {
    return {
      reason: this.aborted ? "interrupted" : "settled",
      ...(this.aborted || this.text === "" ? {} : { text: this.text }),
      ...(this.turnId === undefined ? {} : { turn_id: this.turnId }),
    }
  }

  #ask(request: unknown, id?: string): void {
    if (!isObject(request)) return
    const requestId = id ?? nonEmpty(request["id"])
    const pending = requestId === undefined ? undefined : pendingRequestOf(request, requestId)
    if (requestId !== undefined && pending !== undefined)
      this.#asked.set(requestId, { kind: pending.kind, raiserOnly: raiserOnly(request) })
  }

  /**
   * A run lease newer than the last one seen: running runs, waiting_human asks, any other state ends the run. Answers
   * whether it ended a run in flight.
   */
  #lease(lease: Lease | undefined): boolean {
    if (lease === undefined || lease.seq <= this.#leaseSeq) return false
    this.#leaseSeq = lease.seq
    this.#asksElsewhere = lease.state === "waiting_human"
    if (lease.state === "running") this.#markRunning()
    else if (runOver(lease)) return this.#markEnded()
    return false
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
        this.#markRunning()
        return this.#update()
      case "agent_settled":
        return this.#update(false, this.#markEnded())
      case "session_lifecycle":
        return this.#update(false, this.#lease(leaseOf(record["lifecycle"])))
      case "entry_appended":
        return this.#update(false, this.#lease(newestLease([record["entry"]])))
      // The mirror of a raiser-only request: attach.ts passes it on as a record, never as a frame.
      case "ui_request_pending": {
        const id = nonEmpty(record["uiRequestId"])
        if (id === undefined) return []
        // Already raised as this client's own frame: it stays answerable here, as it was raised.
        if (this.#asked.has(id)) return []
        this.#ask(record["request"], id)
        return this.#update(true)
      }
      case "ui_request_settled": {
        const id = nonEmpty(record["uiRequestId"])
        return id !== undefined && this.#asked.delete(id) ? this.#update() : []
      }
      case "session_status": {
        const status = nonEmpty(record["status"])
        if (status === "closed") return "closed"
        this.#compacting = status === "compacting"
        this.#asksElsewhere = status === "waiting_input"
        if (status === "running") this.#markRunning()
        return this.#update(false, status === "idle" && this.#markEnded())
      }
      default:
        return []
    }
  }

  /** The followed send's turn began: the session runs it (its agent_start carries no client id). */
  markRunning(): readonly Signal[] {
    this.#markRunning()
    return this.#update()
  }

  #markRunning(): void {
    this.running = true
    this.#endPending = false
  }

  /** An observed end of the run: the only way `running` goes false. Answers whether a run was in flight. */
  #markEnded(): boolean {
    const was = this.running
    this.running = false
    this.#asksElsewhere = false
    return was
  }

  /** The status the fields now give, as a signal when it changed (or `always`); `run_ended` when a run just ended. */
  #update(always = false, ended = false): readonly Signal[] {
    const status =
      this.#asked.size > 0 || this.#asksElsewhere
        ? "waiting_input"
        : this.#compacting
          ? "compacting"
          : this.running
            ? "running"
            : "idle"
    const changed = status !== this.status
    this.status = status
    if (ended) this.#endPending = true
    if (this.#endPending && status === "idle") {
      this.#endPending = false
      return [{ kind: "run_ended" }]
    }
    return changed || always ? [{ kind: "status", status }] : []
  }
}

/**
 * One engine state as `sessions.get` reports it, by the rule follow and wait apply (#13753): `running` when the state
 * shows a run in flight (`isStreaming`, or a run lease, `state.lifecycle` or the newest `session-lifecycle` entry among
 * `entries`, still running); `waiting_input` when it asks a person; `compacting`; else `idle`. A stale `isStreaming:
 * false` cannot hide a run the lease still holds. Read it from a fresh `get_state` (pass a snapshot's entries too when
 * there is one), never from a held reply.
 */
export function sessionStatusOf(state: JsonObject, entries: readonly unknown[] = []): string {
  const turn = new SessionTurn()
  turn.fresh(state, entries)
  return turn.status
}

/**
 * The lease states that say the run is over: the ones senpi ranks below running (session-lifecycle-reducer). A Stop or a
 * hold ranks paused and held ahead of running, so they say nothing about the turn: its own records end it (a Stop's
 * aborted agent_end), and waiting_human is a turn waiting on a person.
 */
const RUN_OVER: ReadonlySet<string> = new Set(["waiting_children", "waiting_background", "done", "failed", "cancelled"])

/** A run lease that says the run is over (RUN_OVER). */
const runOver = (lease: Lease): boolean => RUN_OVER.has(lease.state)

/** A record's client message ids: the one it carries, and every input of its turn when it names several. */
const clientIdsOf = (record: JsonObject): readonly string[] => {
  const list = record["clientMessages"]
  const listed = Array.isArray(list)
    ? list.flatMap((input) => {
        const id = isObject(input) ? nonEmpty(input["clientMessageId"]) : undefined
        return id === undefined ? [] : [id]
      })
    : []
  const own = nonEmpty(record["clientMessageId"])
  return own === undefined ? listed : [own, ...listed]
}

/**
 * follow and wait `from` one send (#13753). The engine stamps the prompt's clientMessageId on every record of the turn
 * that answers it (senpi ClientMessageEvents: turn_start, message_*, tool_execution_*, its message entries, turn_end,
 * agent_end), live and in any replay; leases, session_status, agent_start and agent_settled carry none (live relay
 * trace). So the send's turn is exactly the records that carry its id: nothing else is its text or its end, whatever the
 * attach replays. It ends at an agent_end that carries the id, or when another input's turn takes over (a queued input
 * is answered inside the same run, whose agent_end then names only the last input).
 */
class SendTurn {
  readonly #id: string
  #seen = false

  constructor(id: string) {
    this.#id = id
  }

  /**
   * What `record` is to this send: one of its turn's records; its turn's end (its own agent_end); "over" (another input's
   * turn started: a turn_start without this id, stamped with another input's id or with none at all, since an id-less
   * input such as an extension's custom-message follow-up clears the correlation); "ran_out" (the run ended after the
   * send's turn with no record of its own saying so: an agent_end or agent_settled without this id, an idle status, a
   * run lease neither running nor waiting on a person); or none of these.
   */
  classify(record: JsonObject): "ours" | "end" | "over" | "ran_out" | "other" {
    const ids = clientIdsOf(record)
    const type = record["type"]
    if (ids.includes(this.#id)) {
      this.#seen = true
      // An agent_end before a provider retry (willRetry) is not the end: the retried run answers under the same id.
      return type === "agent_end" && record["willRetry"] !== true ? "end" : "ours"
    }
    if (!this.#seen) return "other"
    if (type === "turn_start") return "over"
    if (type === "agent_end" || type === "agent_settled") return "ran_out"
    if (type === "session_status" && record["status"] === "idle") return "ran_out"
    const lease = recordLease(record)
    return lease !== undefined && runOver(lease) ? "ran_out" : "other"
  }

  /** A fresh state after a relay gap: the run lease off running means the send's turn ended in the gap. */
  ranOutIn(state: JsonObject): boolean {
    const lease = leaseOf(state["lifecycle"])
    return this.#seen && lease !== undefined && runOver(lease)
  }

  get started(): boolean {
    return this.#seen
  }
}

/** A send's turn end, under the receipt's turn id: the identity the send itself reported. */
const sendOutcome = (turn: SessionTurn, from: SendReceipt): FollowOutcome => {
  const { turn_id: _runId, ...outcome } = turn.outcome()
  return { ...outcome, ...(from.turn_id === undefined ? {} : { turn_id: from.turn_id }) }
}

const WAITING: Readonly<Record<string, Extract<FollowEvent, { readonly kind: "waiting" }>["state"]>> = {
  running: "turn_running",
  idle: "idle",
  waiting_input: "awaiting_approval",
  compacting: "compacting",
  opening: "queued",
}

// How long a re-attach's get_state that says a send's run is over waits for that turn's own records (#13753 review L3).
const RESYNC_GRACE_MS = 2_000

const RETRY_WAIT = "Call sessions.get for the session's state, then sessions.wait again."

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

  const follow = (thread: ThreadHandle, opts?: FollowOpts) => {
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
      resyncEnd?.()
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
      // A person sees the requests this client can answer; anyone else, or a request only its raiser may answer (a
      // secret input on another connection), gets the count and kinds.
      const asked = turn?.asked() ?? []
      if (person && !asked.some((request) => request.raiserOnly))
        return { kind: "waiting", state, pending: watch?.handle.pending() ?? [] }
      return {
        kind: "waiting",
        state,
        pending_redacted: { count: asked.length, kinds: asked.map((request) => request.kind) },
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

    // From one send: only the records that carry its id (SendTurn); the session's state and leases are not consulted.
    const from = opts?.from
    const send = from?.delivery_id === undefined ? undefined : new SendTurn(from.delivery_id)
    // A re-attach's get_state that says the run is over ends the turn only if no record of the send follows it within
    // RESYNC_GRACE_MS: the turn's own end, with its last text and its aborted flag, wins when it still streams.
    let resyncEnd: (() => void) | undefined
    const ofSend = (event: AttachEvent): void => {
      if (turn === undefined || from === undefined || send === undefined) return
      if (event.kind !== "record") return deliver(turn.apply(event))
      const seen = send.started
      const verdict = send.classify(event.record)
      if (verdict === "other") return
      resyncEnd?.()
      resyncEnd = undefined
      // Another turn's records are never applied: its agent_end must not mark this turn interrupted.
      if (verdict === "over" || verdict === "ran_out") return finish({ kind: "end", outcome: sendOutcome(turn, from) })
      if (!seen) deliver(turn.markRunning())
      deliver(turn.apply(event))
      if (verdict === "end" && !finished) finish({ kind: "end", outcome: sendOutcome(turn, from) })
    }

    let anchor: FollowAnchor | undefined
    const release = (events: readonly AttachEvent[]): void => {
      for (const event of events) if (turn !== undefined) deliver(turn.apply(event))
    }
    void watchSession(core, thread, opts?.signal, {
      event: (event) => (send === undefined ? release(anchor?.accept(event) ?? []) : ofSend(event)),
      snapshot: (snapshot) => {
        if (send === undefined) deliver(turn?.resync(snapshot) ?? [])
      },
      fresh: (state) => {
        // From a send, only a re-attach reads the state: its run lease off running ends a turn whose end fell in the gap.
        if (send !== undefined) {
          const ending = turn
          if (ending !== undefined && from !== undefined && resyncEnd === undefined && send.ranOutIn(state))
            resyncEnd = core.timers.after(RESYNC_GRACE_MS, () =>
              finish({ kind: "end", outcome: sendOutcome(ending, from) }),
            )
          return
        }
        deliver(turn?.fresh(state) ?? [])
        release(anchor?.baseline(leaseOf(state["lifecycle"])) ?? [])
      },
      ended: () => fail(attachEnded()),
    }).then((opened) => {
      if (opened.kind === "error") return fail(opened)
      watch = opened.value
      if (finished) return watch.stop()
      turn = new SessionTurn()
      if (send !== undefined) {
        if (person) for (const request of watch.handle.pending()) output.push({ kind: "frame", request })
        if (from?.lane === "queued" || from?.lane === "queued_offline")
          output.push({ kind: "waiting", state: "queued" })
        return watch.start()
      }
      turn.resync(opened.value.initial)
      if (person) for (const request of watch.handle.pending()) output.push({ kind: "frame", request })
      const first = waiting(turn.status)
      if (first !== undefined) output.push(first)
      const atOpen = snapshotLease(opened.value.initial)
      const anchored = new FollowAnchor(atOpen)
      anchor = anchored
      watch.start()
      // Without a fresh state the snapshot's lease is the best anchor this follow has.
      void watch.baseline().then((unread) => {
        if (unread !== undefined) release(anchored.baseline(atOpen))
      })
    })
    return output.stream
  }

  const wait = (thread: ThreadHandle, opts?: FollowOpts): R<WaitResult> => {
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
        resyncEnd?.()
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
      // The records go through follow's anchor too: a turn the attach replays (its agent_settled above all) never
      // settles a wait while a newer run is live (#13753 review M1).
      let anchor: FollowAnchor | undefined
      const release = (events: readonly AttachEvent[]): void => {
        for (const event of events) if (turn !== undefined) check(turn.apply(event))
      }
      // From one send: settled on its turn's end (idle) or on the next input taking over (running), nothing else.
      const send = opts?.from?.delivery_id === undefined ? undefined : new SendTurn(opts.from.delivery_id)
      let resyncEnd: (() => void) | undefined
      const ofSend = (event: AttachEvent): void => {
        if (turn === undefined || send === undefined) return
        if (event.kind !== "record") return check(turn.apply(event))
        const verdict = send.classify(event.record)
        if (verdict !== "other") {
          resyncEnd?.()
          resyncEnd = undefined
        }
        if (verdict === "end" || verdict === "ran_out") return result("settled", "idle")
        if (verdict === "over") return result("settled", "running")
        if (verdict === "ours") turn.markRunning()
      }
      void watchSession(core, thread, opts?.signal, {
        event: (event) => (send === undefined ? release(anchor?.accept(event) ?? []) : ofSend(event)),
        snapshot: (snapshot) => {
          if (send === undefined) check(turn?.resync(snapshot) ?? [])
        },
        fresh: (state) => {
          // From a send, only a re-attach reads the state: its run lease off running ends a turn whose end fell in the gap.
          if (send !== undefined) {
            if (resyncEnd === undefined && send.ranOutIn(state))
              resyncEnd = core.timers.after(RESYNC_GRACE_MS, () => result("settled", "idle"))
            return
          }
          check(turn?.fresh(state) ?? [])
          release(anchor?.baseline(leaseOf(state["lifecycle"])) ?? [])
        },
        ended: () => done(attachEnded()),
      }).then(async (opened) => {
        if (opened.kind === "error") return done(opened)
        watch = opened.value
        if (settled) return watch.stop()
        turn = new SessionTurn()
        if (send !== undefined) return watch.start()
        turn.resync(opened.value.initial)
        const atOpen = snapshotLease(opened.value.initial)
        const anchored = new FollowAnchor(atOpen)
        anchor = anchored
        check([])
        watch.start()
        const unread = await opened.value.baseline()
        if (unread !== undefined) release(anchored.baseline(atOpen))
        // Without a fresh state "no run" is unknown (the snapshot's idle can be stale): a run already seen is still
        // waited for, but a wait that would answer settled/idle answers why it cannot tell instead.
        if (unread === undefined) confirmed = true
        else if (!turn.running && turn.status !== "waiting_input")
          return done({ ...unread, details: { ...unread.details, phase: "baseline" } })
        check([])
      })
    })
  }

  return { follow, wait }
}
