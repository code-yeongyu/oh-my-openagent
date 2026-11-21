import { randomUUID } from "node:crypto"
import type { Socket } from "node:net"

import type {
  CommandStateEvent,
  JsonObject,
  RemoteAttach,
  RemoteAttachEvent,
  SnapshotBody,
} from "../device-service-core/src/index.ts"
import { outcomeFailure, outcomeOf } from "../omo-senpi/src/components/thread/remote/outcome"
import { MirroredDialogs, pendingIds } from "./remote-attach-dialogs"

// A person drives these records (a slash command an extension runs, a compaction, a bash call), and the engine replies
// only when the command finishes, so the attach terminal waits far longer than a tool call would; it still never waits
// forever on a final state the relay lost.
const FORWARD_WAIT_MS = 60 * 60_000

// One authenticated attach TUI connection to the `omo remote attach` endpoint (remote-attach.ts): the attach's session
// presented as the one row LOCAL_SESSION_ID, its plumbing answered here, every other record forwarded to the host.

/** The session id this endpoint presents; the remote engine's own id is never needed by the TUI. */
export const LOCAL_SESSION_ID = "remote"

type Json = Record<string, unknown>

export const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value)
/** A non-applied outcome as the host or engine stated it: the state, then its reason when it has one. */
const outcomeText = (outcome: CommandStateEvent, device: string): string => {
  // The same mapping every relay request is explained by (#12885); a state that mapping calls applied keeps its own name.
  const mapped = outcomeOf({ outcome })
  return mapped.kind === "ok" ? outcome.state : outcomeFailure(mapped, device).error.message
}

function stateOf(snapshot: SnapshotBody): Json {
  const state = isRecord(snapshot.state) ? snapshot.state : {}
  return { ...state, sessionId: LOCAL_SESSION_ID, isStreaming: state.isStreaming === true }
}

export class Presentation {
  private snapshot: SnapshotBody | undefined
  private streaming = false
  private stopStream: (() => void) | undefined
  private readonly dialogs = new MirroredDialogs()
  private readonly attach: RemoteAttach
  private readonly label: string
  private readonly socket: Socket

  constructor(attach: RemoteAttach, label: string, socket: Socket) {
    this.attach = attach
    this.label = label
    this.socket = socket
  }

  /** Like a host, records flow only once the TUI subscribed: it drops records of a session it has not selected yet. */
  private startStream(): void {
    if (this.streaming) return
    this.streaming = true
    this.notify(`Attached to ${this.label}`, "info")
    const stopEvents = this.attach.onEvent((event) => this.event(event))
    const stopFrames = this.attach.onFrame((frame) =>
      this.send("sessionId" in frame ? { ...frame, sessionId: LOCAL_SESSION_ID } : frame),
    )
    const stopLosses = this.attach.onChannelLoss((reason) =>
      this.notify(`Lost a reply or event from the remote device: ${reason}`, "warning"),
    )
    this.stopStream = () => {
      stopEvents()
      stopFrames()
      stopLosses()
    }
  }

  stop(): void {
    this.stopStream?.()
  }

  send(value: Json): void {
    if (this.socket.writable && !this.socket.destroyed) this.socket.write(`${JSON.stringify(value)}\n`)
  }

  event(event: RemoteAttachEvent): void {
    switch (event.kind) {
      case "snapshot":
        // Every snapshot (the first and each re-attach after a relay gap) presents its pending dialogs and questions as
        // the TUI's request frames (#13482, omo#13474); the TUI shows a request id once, so get_state's copy of the same
        // dialogs does not show it twice.
        this.presentPending(event.snapshot)
        this.snapshot = event.snapshot
        return
      case "records":
        for (const record of event.records) {
          const dialog = this.dialogs.present(record, LOCAL_SESSION_ID)
          if (dialog !== null) this.send(dialog ?? { ...record, sessionId: LOCAL_SESSION_ID })
        }
        return
      case "pending":
        this.notify("Waiting for the remote device to share this session", "info")
        return
      case "detached":
        this.notify(`The remote session ended (${event.reason})`, "warning")
        this.socket.end()
        return
    }
  }

  /** A snapshot's pending dialogs and questions as the TUI may answer them, each remembered so its answer names it. */
  private pendingOf(snapshot: SnapshotBody): {
    readonly pendingDialogs: JsonObject[]
    readonly pendingQuestions: JsonObject[]
  } {
    const state = isRecord(snapshot.state) ? snapshot.state : {}
    return {
      pendingDialogs: this.dialogs.pending(state.pendingDialogs, LOCAL_SESSION_ID),
      pendingQuestions: this.dialogs.pending(state.pendingQuestions, LOCAL_SESSION_ID),
    }
  }

  private presentPending(snapshot: SnapshotBody): void {
    const { pendingDialogs, pendingQuestions } = this.pendingOf(snapshot)
    const pending = [...pendingDialogs, ...pendingQuestions]
    const state = isRecord(snapshot.state) ? snapshot.state : {}
    const still = pendingIds(state.pendingDialogs, state.pendingQuestions)
    for (const resolved of this.dialogs.settledAway(still, LOCAL_SESSION_ID)) this.send(resolved)
    for (const dialog of pending) this.send(dialog)
  }

  notify(message: string, notifyType: "info" | "warning"): void {
    this.send({
      type: "extension_ui_request",
      id: randomUUID(),
      method: "notify",
      message,
      notifyType,
      sessionId: LOCAL_SESSION_ID,
    })
  }

  async answer(request: JsonObject): Promise<void> {
    const type = String(request.type)
    const reply = (data: Json = {}) =>
      this.send({ type: "response", id: request.id, command: type, success: true, data })
    const refuse = (error: string) =>
      this.send({ type: "response", id: request.id, command: type, success: false, error })
    try {
      // Endpoint plumbing, answered here because each one presents this endpoint or the attach's own view rather
      // than acting on the engine: they are the attach TUI's handshake (senpi modes/interactive/attach.ts).
      switch (type) {
        // The TUI's client declaration, its claim on the presented row, and its release of that claim: they describe
        // the TUI's connection to THIS endpoint; the host's engine connection is the device service's, not the TUI's.
        case "set_client_info":
        case "attach_session":
        case "release_attachment":
          return reply()
        // The one presented row: LOCAL_SESSION_ID, standing for the attached session.
        case "list_sessions":
          return reply({
            sessions: [
              {
                sessionId: LOCAL_SESSION_ID,
                durableSessionId: this.attach.sessionId,
                retain_on_disconnect: true,
                sessionName: this.label,
              },
            ],
          })
        // The row's stream: the attach's own session.records, already flowing to this device.
        case "subscribe_sessions":
          reply({ subscriptionId: randomUUID(), snapshot: [] })
          return this.startStream()
        // The row's state and history: the attach's snapshot and its session.read pages.
        case "get_state": {
          const snapshot = this.snapshot ?? (await this.attach.snapshot)
          this.snapshot = snapshot
          return reply({ ...stateOf(snapshot), ...this.pendingOf(snapshot) })
        }
        case "get_entries":
          return reply(await this.entries(request))
        default:
          return await this.forward(request, type)
      }
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * Every record that is not plumbing: sent to the host unchanged, answered on its own id. The engine's own reply,
   * when the host sent one, goes back verbatim (its refusals included); a host without delegated commands sends only
   * the outcome, shown as success or as "<state>: <reason>". LOCAL_SESSION_ID names the attached session, so it
   * travels as that session's id, the route the host derives the engine sessionId from (H1); a record without a
   * sessionId, or naming another one, goes as it is for the host to decide.
   */
  private async forward(request: JsonObject, type: string): Promise<void> {
    const named = this.dialogs.answer(request)
    const rpc = named.sessionId === LOCAL_SESSION_ID ? { ...named, sessionId: this.attach.sessionId } : named
    const { outcome, response } = await this.attach.command(rpc, { waitMs: FORWARD_WAIT_MS })
    if (response !== undefined) {
      this.send({ ...response, id: request.id })
      return
    }
    if (outcome.state === "engine_applied") {
      this.send({ type: "response", id: request.id, command: type, success: true })
      return
    }
    this.send({
      type: "response",
      id: request.id,
      command: type,
      success: false,
      error: outcomeText(outcome, this.attach.device),
    })
  }

  private async entries(request: Json): Promise<Json> {
    const before = typeof request.before === "string" ? request.before : undefined
    const tail = typeof request.tail === "number" ? Math.min(Math.max(Math.trunc(request.tail), 1), 200) : undefined
    if (before === undefined) {
      const snapshot = this.snapshot ?? (await this.attach.snapshot)
      this.snapshot = snapshot
      const next =
        snapshot.history_truncated && snapshot.oldest_entry_id !== null ? { next_before: snapshot.oldest_entry_id } : {}
      return { entries: snapshot.entries, leafId: null, ...next }
    }
    const page = await this.attach.read({ before, ...(tail === undefined ? {} : { tail }) })
    const shown = page.entries.flatMap((entry) => ("entry" in entry ? [entry.entry] : []))
    const skipped = page.entries.length - shown.length
    if (skipped > 0)
      this.notify(`${skipped} older ${skipped === 1 ? "entry is" : "entries are"} too large to show`, "info")
    return { entries: shown, leafId: null, ...(page.next_before === null ? {} : { next_before: page.next_before }) }
  }
}
