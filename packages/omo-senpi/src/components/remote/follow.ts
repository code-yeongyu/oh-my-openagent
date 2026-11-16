import { eventStream, openAttachment } from "./attach"
import { type ClientCore, ok, type RemoteClient } from "./client"
import { nextActionFor, remoteFailure } from "./codes"
import { DEADLINES } from "./deadlines"
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
  /** The attach's events ended (after `session_closed` when the session closed). */
  readonly ended: () => void
}
type SessionWatch = { readonly initial: SnapshotBody; readonly handle: AttachHandle; readonly stop: () => void }

/**
 * The ONE place follow and wait take a session's events: today the attach this module opens (attach.ts), which ends at a
 * relay, service or engine restart. rt-monitor-wait's attach pool and watch v2 (feat/remote-session-wait) re-attach and
 * resync across those; switching to it replaces only this function.
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
  let stopped = false
  const stopSnapshots = onSnapshot((snapshot) => {
    if (!stopped) handlers.snapshot(snapshot)
  })
  void (async () => {
    for await (const event of handle.events) if (!stopped) handlers.event(event)
    if (!stopped) handlers.ended()
  })()
  return ok({
    initial: handle.snapshot,
    handle,
    stop: () => {
      stopped = true
      stopSnapshots()
      void handle.detach()
    },
  })
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined

// Lifted from rt-monitor-wait (feat/remote-session-wait, thread/remote/session-state.ts `sessionStateOf` and `statusOf`):
// the status a snapshot's state implies, and the status a record moves the session to. A `session_status` record names
// it; a stream that never carried one moves it by the run's lifecycle: `agent_start` runs, `agent_settled` idles.
const snapshotStatus = (snapshot: SnapshotBody): string => {
  const state = isObject(snapshot.state) ? snapshot.state : {}
  const questions = state["pendingQuestions"]
  const dialogs = state["pendingDialogs"]
  return state["isCompacting"] === true
    ? "compacting"
    : (Array.isArray(questions) && questions.length > 0) || (Array.isArray(dialogs) && dialogs.length > 0)
      ? "waiting_input"
      : state["isStreaming"] === true
        ? "running"
        : "idle"
}
const recordStatus = (record: JsonObject, sawStatusRecord: boolean): string | undefined => {
  const type = record["type"]
  if (type === "session_status") return nonEmpty(record["status"])
  if (sawStatusRecord) return undefined
  return type === "agent_start" ? "running" : type === "agent_settled" ? "idle" : undefined
}

type Signal =
  | { readonly kind: "status"; readonly status: string }
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
  status: string
  ran: boolean
  text = ""
  turnId: string | undefined
  aborted = false
  #sawStatusRecord = false

  constructor(initial: SnapshotBody) {
    this.status = snapshotStatus(initial)
    this.ran = this.status !== "idle"
  }

  /** What an attach event changes, in order; `closed` once the session left its engine. */
  apply(event: AttachEvent): readonly Signal[] | "closed" {
    switch (event.kind) {
      case "record":
        return this.#record(event.record)
      case "frame":
        return [{ kind: "frame", request: event.request }, ...this.#move("waiting_input", true)]
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

  resync(snapshot: SnapshotBody): readonly Signal[] {
    return this.#move(snapshotStatus(snapshot))
  }

  outcome(): FollowOutcome {
    return {
      reason: this.aborted ? "interrupted" : "settled",
      ...(this.aborted || this.text === "" ? {} : { text: this.text }),
      ...(this.turnId === undefined ? {} : { turn_id: this.turnId }),
    }
  }

  #record(record: JsonObject): readonly Signal[] | "closed" {
    const type = record["type"]
    if (type === "session_status") this.#sawStatusRecord = true
    if (type === "agent_start") {
      this.text = ""
      this.aborted = false
      this.turnId = nonEmpty(record["runId"])
    }
    if (type === "agent_end") this.aborted = record["aborted"] === true
    const status = recordStatus(record, this.#sawStatusRecord)
    if (status === "closed") return "closed"
    const moved = status === undefined ? [] : this.#move(status)
    const update = record["assistantMessageEvent"]
    if (type === "message_update" && isObject(update) && update["type"] === "text_delta") {
      const delta = typeof update["delta"] === "string" ? update["delta"] : ""
      this.text += delta
      return [...moved, { kind: "text", delta }]
    }
    const tool = toolEvent(record)
    return tool === undefined ? moved : [...moved, tool]
  }

  #move(status: string, always = false): readonly Signal[] {
    if (status === this.status && !always) return []
    this.status = status
    if (status === "running") this.ran = true
    return [{ kind: "status", status }]
  }
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
    const output = eventStream<FollowEvent>(() => finish())
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
        if (signal.kind === "status") {
          if (signal.status === "idle" && turn.ran) return finish({ kind: "end", outcome: turn.outcome() })
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
      ended: () => fail(attachEnded()),
    }).then((opened) => {
      if (opened.kind === "error") return fail(opened)
      watch = opened.value
      if (finished) return watch.stop()
      turn = new SessionTurn(opened.value.initial)
      if (person) for (const request of watch.handle.pending()) output.push({ kind: "frame", request })
      const first = waiting(turn.status)
      if (first !== undefined) output.push(first)
    })
    return output.stream
  }

  const wait = (thread: ThreadHandle, opts?: Opts): R<WaitResult> => {
    const start = core.timers.now()
    return new Promise((resolve) => {
      let watch: SessionWatch | undefined
      let turn: SessionTurn | undefined
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
      // A session that is idle, or waits on a person's answer, has nothing left to wait for.
      const check = (signals: readonly Signal[] | "closed"): void => {
        if (signals === "closed") return result("ended", "closed")
        if (turn?.status === "idle" || turn?.status === "waiting_input") result("settled")
      }
      void watchSession(core, thread, opts?.signal, {
        event: (event) => check(turn?.apply(event) ?? []),
        snapshot: (snapshot) => check(turn?.resync(snapshot) ?? []),
        ended: () => done(attachEnded()),
      }).then((opened) => {
        if (opened.kind === "error") return done(opened)
        watch = opened.value
        if (settled) return watch.stop()
        turn = new SessionTurn(opened.value.initial)
        check([])
      })
    })
  }

  return { follow, wait }
}
