import type { RemoteAttach } from "@oh-my-opencode/device-service-core/device-service"
import { serveRemoteAttach } from "../../../../omo-native/remote-attach"
import { outcomeOf } from "../thread/remote/outcome"
import { type ClientCore, ok, type Outcome, type RemoteClient } from "./client"
import { engineCode, nextActionFor, remoteFailure } from "./codes"
import { DEADLINES, withinDeadline } from "./deadlines"
import { canonicalizeThreadHandle } from "./seams"
import type {
  AttachEvent,
  AttachHandle,
  JsonObject,
  Opts,
  PendingRequest,
  R,
  RemoteStream,
  SnapshotBody,
  ThreadHandle,
  UiResponse,
} from "./types"

/** A stream fed by its producer: `push` queues an event, `end` lets the queue drain and finishes; `stop` drops the rest. */
export function eventStream<E>(onStop?: () => void): {
  readonly stream: RemoteStream<E>
  readonly push: (event: E) => void
  readonly end: () => void
} {
  const queue: E[] = []
  let ended = false
  let stopped = false
  let wake: (() => void) | undefined
  const notify = (): void => {
    const waiting = wake
    wake = undefined
    waiting?.()
  }
  const stop = (): void => {
    if (stopped) return
    stopped = true
    ended = true
    queue.length = 0
    notify()
    onStop?.()
  }
  return {
    push: (event) => {
      if (ended) return
      queue.push(event)
      notify()
    },
    end: () => {
      ended = true
      notify()
    },
    stream: {
      stop,
      async *[Symbol.asyncIterator]() {
        try {
          for (;;) {
            const next = queue.shift()
            if (next !== undefined) yield next
            else if (ended) return
            else await new Promise<void>((resolve) => (wake = resolve))
          }
        } finally {
          stop()
        }
      },
    },
  }
}

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined)

// Lifted from omo#12750 (feat/remote-approvals, thread/remote/dialog-mirror.ts `raiserOnly`): a secret input or a grant
// selection is answerable only on the connection that raised it, and relayd refuses every other answer to one, so a
// viewer that sees only the session's mirror is never shown one.
const raiserOnly = (request: JsonObject): boolean => request["secret"] === true || request["grantSelect"] === true

const DIALOG_KINDS: ReadonlySet<string> = new Set(["select", "confirm", "input", "editor", "question"])

/** An engine UI request (senpi `RpcExtensionUIRequest`) as a pending request; undefined for one that asks nothing. */
function pendingRequestOf(request: JsonObject, requestId: string): PendingRequest | undefined {
  const kind = request["method"]
  if (typeof kind !== "string" || !DIALOG_KINDS.has(kind)) return undefined
  const questions = request["questions"]
  const first = Array.isArray(questions) && isObject(questions[0]) ? questions[0] : undefined
  const choices = first === undefined ? request["options"] : first["options"]
  const options = Array.isArray(choices)
    ? choices.flatMap((choice) => {
        const label = isObject(choice) ? text(choice["label"]) : text(choice)
        return label === undefined ? [] : [label]
      })
    : undefined
  const message = text(first === undefined ? request["message"] : first["question"])
  const toolCallId = text(request["toolCallId"])
  const deadline = request["deadlineAtMs"]
  return {
    request_id: requestId,
    kind: kind as PendingRequest["kind"],
    title: text(first === undefined ? request["title"] : first["header"]) ?? "",
    ...(message === undefined ? {} : { message }),
    ...(options === undefined || options.length === 0 ? {} : { options }),
    ...(request["secret"] === true ? { secret: true } : {}),
    ...(toolCallId === undefined ? {} : { tool_call_id: toolCallId }),
    ...(typeof deadline === "number" ? { deadline_at_ms: deadline } : {}),
  }
}

// Dialogs left pending when their settle never arrives (the session ended) stop being remembered past this many.
const SHOWN_KEPT = 1024

/**
 * Lifted from omo#12750 (feat/remote-approvals, omo-native/remote-attach-dialogs.ts `MirroredDialogs`). relayd sends a
 * dialog in its local shape (`extension_ui_request`) only on the delegated connection that raised it; every other attach
 * sees the session's mirror, `ui_request_pending {uiRequestId, request}` and `ui_request_settled {uiRequestId,
 * disposition}`. This presents both as attach events under the uiRequestId and remembers each shown one, so a later
 * snapshot (a re-attach after a relay gap) settles the ones it no longer holds. The shown requests are also the pending
 * ones: the set the latest snapshot held, plus the ones raised since, less the ones settled since.
 */
class MirroredDialogs {
  readonly #shown = new Map<string, PendingRequest>()

  /** The event for a dialog mirror record; null when it must not be shown; undefined for any other record. */
  present(record: JsonObject): AttachEvent | null | undefined {
    const uiRequestId = text(record["uiRequestId"])
    if (uiRequestId === undefined) return undefined
    if (record["type"] === "ui_request_settled") {
      this.#shown.delete(uiRequestId)
      const how = record["disposition"] === "answered" ? "answered" : "cancelled"
      return { kind: "frame_settled", request_id: uiRequestId, how }
    }
    if (record["type"] !== "ui_request_pending") return undefined
    const request = record["request"]
    if (!isObject(request) || raiserOnly(request)) return null
    return this.raised(request, uiRequestId)
  }

  /** A request raised to this connection (the mirror's, or the raiser's own delegated frame): shown once per id. */
  raised(request: JsonObject, uiRequestId: string): AttachEvent | null {
    const pending = pendingRequestOf(request, uiRequestId)
    if (pending === undefined || this.#shown.has(uiRequestId)) return null
    this.#remember(pending)
    return { kind: "frame", request: pending }
  }

  /**
   * A snapshot's pending dialogs and questions (`state.pendingDialogs` / `state.pendingQuestions`, whose `id` is the
   * uiRequestId): the ones this attach may answer, each remembered. Answers the ones not shown before.
   */
  pending(requests: unknown): PendingRequest[] {
    if (!Array.isArray(requests)) return []
    return requests.flatMap((request) => {
      const id = isObject(request) ? text(request["id"]) : undefined
      if (!isObject(request) || id === undefined || raiserOnly(request)) return []
      const pending = pendingRequestOf(request, id)
      if (pending === undefined) return []
      const fresh = !this.#shown.has(id)
      this.#remember(pending)
      return fresh ? [pending] : []
    })
  }

  /**
   * After a later snapshot (a re-attach): each request shown that the snapshot no longer holds. It settled while the
   * attach was away and its settle record was lost with the gap.
   */
  settledAway(held: ReadonlySet<string>): string[] {
    return [...this.#shown.keys()].filter((uiRequestId) => {
      if (held.has(uiRequestId)) return false
      this.#shown.delete(uiRequestId)
      return true
    })
  }

  current(): readonly PendingRequest[] {
    return [...this.#shown.values()]
  }

  #remember(request: PendingRequest): void {
    this.#shown.delete(request.request_id)
    this.#shown.set(request.request_id, request)
    for (const oldest of this.#shown.keys()) if (this.#shown.size > SHOWN_KEPT) this.#shown.delete(oldest)
  }
}

const stateOf = (snapshot: SnapshotBody): JsonObject => (isObject(snapshot.state) ? snapshot.state : {})

/** The ids a snapshot holds as pending, raiser-only ones included (they are still pending, only not ours to show). */
const heldIds = (state: JsonObject): Set<string> =>
  new Set(
    [state["pendingDialogs"], state["pendingQuestions"]].flatMap((list) =>
      Array.isArray(list) ? list.flatMap((request) => (isObject(request) ? (text(request["id"]) ?? []) : [])) : [],
    ),
  )

/** What follow and wait need beyond the public handle: every snapshot after the first (a re-attach after a gap). */
export type Attachment = {
  readonly handle: AttachHandle
  readonly onSnapshot: (listener: (snapshot: SnapshotBody) => void) => () => void
}

const answerRecord = (requestId: string, response: UiResponse): JsonObject => ({
  type: "extension_ui_response",
  id: requestId,
  uiRequestId: requestId,
  ...("values" in response ? { values: [...response.values] } : response),
})

function createAttachment(core: ClientCore, attached: RemoteAttach, thread: ThreadHandle): Attachment {
  const dialogs = new MirroredDialogs()
  const snapshotListeners = new Set<(snapshot: SnapshotBody) => void>()
  const endpoints: (() => Promise<void>)[] = []
  const events = eventStream<AttachEvent>()
  let latest: SnapshotBody | undefined

  const snapshot = (next: SnapshotBody): void => {
    const state = stateOf(next)
    if (!Array.isArray(state["pendingDialogs"]))
      events.push({ kind: "approvals_unobservable", device: attached.device })
    const first = latest === undefined
    latest = next
    if (first) {
      dialogs.pending(state["pendingDialogs"])
      dialogs.pending(state["pendingQuestions"])
      return
    }
    for (const request_id of dialogs.settledAway(heldIds(state)))
      events.push({ kind: "frame_settled", request_id, how: "cancelled" })
    for (const request of [...dialogs.pending(state["pendingDialogs"]), ...dialogs.pending(state["pendingQuestions"])])
      events.push({ kind: "frame", request })
    for (const listener of [...snapshotListeners]) listener(next)
  }

  // onEvent replays from the latest snapshot, so the records that arrived since the attach opened are delivered too.
  const stopEvents = attached.onEvent((event) => {
    if (event.kind === "snapshot") return snapshot(event.snapshot)
    if (event.kind !== "records") return
    for (const record of event.records) {
      const presented = dialogs.present(record)
      if (presented === undefined) events.push({ kind: "record", record })
      else if (presented !== null) events.push(presented)
    }
  })
  // The raiser's own frames: a dialog raised by a command this connection sent, secret ones included (only this
  // connection can answer them). Other frames repeat the session's records and are not delivered twice.
  const stopFrames = attached.onFrame((frame) => {
    const id = text(frame["id"])
    if (frame["type"] !== "extension_ui_request" || id === undefined) return
    const raised = dialogs.raised(frame, id)
    if (raised !== null) events.push(raised)
  })
  const stopLosses = attached.onChannelLoss((reason) => events.push({ kind: "channel_lost", reason }))
  void attached.detached.then((reason) => {
    stopFrames()
    stopLosses()
    if (reason === "session_closed" || reason === "session_replaced") events.push({ kind: "session_closed" })
    else if (reason !== "detached") events.push({ kind: "channel_lost", reason })
    events.end()
  })

  const command: AttachHandle["command"] = (rpc) =>
    withinDeadline(core.timers, undefined, DEADLINES.drive, true, async () => ok(await attached.command(rpc)))

  const handle: AttachHandle = {
    get snapshot(): SnapshotBody {
      if (latest === undefined) throw new Error("an attachment is built from its first snapshot")
      return latest
    },
    events: events.stream,
    command,
    read: (page) =>
      withinDeadline(core.timers, undefined, DEADLINES.observeRead, false, async () => ok(await attached.read(page))),
    serveEndpoint: () =>
      withinDeadline(core.timers, undefined, DEADLINES.serveEndpoint, false, async () => {
        const endpoint = await serveRemoteAttach(attached, { label: thread })
        endpoints.push(endpoint.close)
        return ok({ socketPath: endpoint.socketPath, sessionRef: endpoint.sessionRef })
      }),
    pending: () => dialogs.current(),
    answer: async (requestId, response) => {
      const sent = await command(answerRecord(requestId, response))
      if (sent.kind === "error") return sent
      const outcome = outcomeOf(sent.value)
      if (outcome.kind === "ok") return ok({ answered: true as const })
      if (outcome.kind === "uncertain")
        return remoteFailure(
          "unconfirmed",
          `The answer may not have arrived: ${outcome.reason}.`,
          nextActionFor("unconfirmed"),
          {
            uncertain: true,
            details: { reason: outcome.reason },
          },
        )
      const mapped = engineCode(outcome.reason)
      return remoteFailure(
        mapped.code,
        `The device refused the answer: ${outcome.reason}.`,
        nextActionFor(mapped.code),
        {
          ...(mapped.details === undefined ? {} : { details: mapped.details }),
        },
      )
    },
    detach: async () => {
      stopEvents()
      events.end()
      await Promise.all(endpoints.splice(0).map((close) => close()))
      // A session.detach that fails leaves nothing held: the service ended the attach or the connection closed.
      await attached.detach().catch(() => undefined)
    },
  }
  return {
    handle,
    onSnapshot: (listener) => {
      snapshotListeners.add(listener)
      return () => snapshotListeners.delete(listener)
    },
  }
}

/** Opens one session's attach (DeviceService.attach) and waits for its first snapshot, within attachOpen. */
export async function openAttachment(core: ClientCore, thread: ThreadHandle, opts?: Opts): R<Attachment> {
  const parsed = canonicalizeThreadHandle(thread, {})
  if (parsed.kind === "error") return parsed
  const { target } = parsed.value
  if (target.kind !== "device_session")
    return remoteFailure(
      "invalid_arguments",
      `${thread} does not name a session on a device.`,
      "Call sessions.resolve for the thread's handle, then attach to it.",
    )
  let opened: RemoteAttach | undefined
  let abandoned = false
  const outcome = await core.member(opts, DEADLINES.attachOpen, false, async (svc): Promise<Outcome<Attachment>> => {
    const attached = await svc.attach(target.device, target.session)
    opened = attached
    if (abandoned) await attached.detach()
    await attached.snapshot
    return ok(createAttachment(core, attached, parsed.value.handle))
  })
  // An attach that opens after the call gave up is detached, never left subscribed.
  if (outcome.kind === "error") {
    abandoned = true
    void opened?.detach().catch(() => undefined)
  }
  return outcome
}

/** `attach`: one session's live attach, its snapshot, records, pending UI requests and their answers. */
export function attachMember(core: ClientCore): RemoteClient["attach"] {
  return async (thread, opts) => {
    const opened = await openAttachment(core, thread, opts)
    return opened.kind === "error" ? opened : ok(opened.value.handle)
  }
}
