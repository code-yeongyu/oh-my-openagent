import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, win32 } from "node:path"

import type { CommandStateEvent, JsonObject, RemoteAttach, RemoteAttachEvent, SnapshotBody } from "../device-service-core/src/index.ts"
import { outcomeFailure, outcomeOf } from "../omo-senpi/src/components/thread/remote/outcome"

// `omo remote attach` serves one remote session to the engine's unchanged attach TUI (`--attach <socket> --session
// <ref>`): a private endpoint that speaks the RPC subset the TUI uses, answered from the device service's attach.
// The TUI authenticates a `t-<16 hex>.sock` endpoint with the 32-byte secret beside it on every platform, and on
// Windows reaches the named pipe derived from that path and secret, so this endpoint follows the same two rules.
// The endpoint answers only its own plumbing (the attach handshake and the presented row, see `answer`); every other
// record goes to the host unchanged as a delegated `session.command {rpc}`, and the host's engine decides it (DS2b G1,
// M6); the engine's reply and the frames it writes on that delegated connection come back to the TUI.

const SECRET_BYTES = 32
const HANDSHAKE_TIMEOUT_MS = 2_000
const MAX_LINE_CHARS = 64 * 1024 * 1024
const PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
/** The session id this endpoint presents; the remote engine's own id is never needed by the TUI. */
export const LOCAL_SESSION_ID = "remote"

type Json = Record<string, unknown>

export type RemoteAttachEndpoint = {
  /** Pass as `--attach`. */
  readonly socketPath: string
  /** Pass as `--session`. */
  readonly sessionRef: string
  readonly close: () => Promise<void>
}

export function pipeAddress(socketPath: string, secret: Uint8Array): string {
  const canonical = win32.normalize(socketPath).toLowerCase()
  const identity = Buffer.concat([Buffer.from(canonical, "utf8"), Buffer.from(secret)])
  return `${PIPE_PREFIX}${createHash("sha256").update(identity).digest("hex").slice(0, 32)}`
}

const isRecord = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value)
// A record JSON.parse produced holds only JSON values, so an object from one line is a JsonObject.
const isParsedRecord = (value: unknown): value is JsonObject => isRecord(value)

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

class Presentation {
  private snapshot: SnapshotBody | undefined
  private streaming = false
  private stopStream: (() => void) | undefined
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
    const stopEvents = this.attach.onEvent(event => this.event(event))
    const stopFrames = this.attach.onFrame(frame => this.send("sessionId" in frame ? { ...frame, sessionId: LOCAL_SESSION_ID } : frame))
    const stopLosses = this.attach.onChannelLoss(reason => this.notify(`Lost a reply or event from the remote device: ${reason}`, "warning"))
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
        this.snapshot = event.snapshot
        return
      case "records":
        for (const record of event.records) this.send({ ...record, sessionId: LOCAL_SESSION_ID })
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

  notify(message: string, notifyType: "info" | "warning"): void {
    this.send({ type: "extension_ui_request", id: randomUUID(), method: "notify", message, notifyType, sessionId: LOCAL_SESSION_ID })
  }

  async answer(request: JsonObject): Promise<void> {
    const type = String(request.type)
    const reply = (data: Json = {}) => this.send({ type: "response", id: request.id, command: type, success: true, data })
    const refuse = (error: string) => this.send({ type: "response", id: request.id, command: type, success: false, error })
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
            sessions: [{ sessionId: LOCAL_SESSION_ID, durableSessionId: this.attach.sessionId, retain_on_disconnect: true, sessionName: this.label }],
          })
        // The row's stream: the attach's own session.records, already flowing to this device.
        case "subscribe_sessions":
          reply({ subscriptionId: randomUUID(), snapshot: [] })
          return this.startStream()
        // The row's state and history: the attach's snapshot and its session.read pages.
        case "get_state": {
          const snapshot = this.snapshot ?? (await this.attach.snapshot)
          this.snapshot = snapshot
          return reply(stateOf(snapshot))
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
    const rpc = request.sessionId === LOCAL_SESSION_ID ? { ...request, sessionId: this.attach.sessionId } : request
    const { outcome, response } = await this.attach.command(rpc)
    if (response !== undefined) {
      this.send({ ...response, id: request.id })
      return
    }
    if (outcome.state === "engine_applied") {
      this.send({ type: "response", id: request.id, command: type, success: true })
      return
    }
    this.send({ type: "response", id: request.id, command: type, success: false, error: outcomeText(outcome, this.attach.device) })
  }

  private async entries(request: Json): Promise<Json> {
    const before = typeof request.before === "string" ? request.before : undefined
    const tail = typeof request.tail === "number" ? Math.min(Math.max(Math.trunc(request.tail), 1), 200) : undefined
    if (before === undefined) {
      const snapshot = this.snapshot ?? (await this.attach.snapshot)
      this.snapshot = snapshot
      const next = snapshot.history_truncated && snapshot.oldest_entry_id !== null ? { next_before: snapshot.oldest_entry_id } : {}
      return { entries: snapshot.entries, leafId: null, ...next }
    }
    const page = await this.attach.read({ before, ...(tail === undefined ? {} : { tail }) })
    const shown = page.entries.flatMap(entry => ("entry" in entry ? [entry.entry] : []))
    const skipped = page.entries.length - shown.length
    if (skipped > 0) this.notify(`${skipped} older ${skipped === 1 ? "entry is" : "entries are"} too large to show`, "info")
    return { entries: shown, leafId: null, ...(page.next_before === null ? {} : { next_before: page.next_before }) }
  }
}

function authenticate(socket: Socket, secret: Buffer, onAuthenticated: () => void): void {
  let received = Buffer.alloc(0)
  const timer = setTimeout(() => socket.destroy(), HANDSHAKE_TIMEOUT_MS)
  const onData = (chunk: Buffer) => {
    received = Buffer.concat([received, chunk])
    if (received.length < secret.length) return
    clearTimeout(timer)
    socket.off("data", onData)
    if (!timingSafeEqual(received.subarray(0, secret.length), secret)) {
      socket.destroy()
      return
    }
    const rest = received.subarray(secret.length)
    if (rest.length > 0) socket.unshift(rest)
    onAuthenticated()
  }
  socket.on("data", onData)
  socket.once("close", () => clearTimeout(timer))
}

function serveLines(socket: Socket, onLine: (line: string) => void): void {
  let buffer = ""
  socket.setEncoding("utf8")
  socket.on("data", (chunk: string) => {
    buffer += chunk
    if (buffer.length > MAX_LINE_CHARS) {
      socket.destroy()
      return
    }
    let newline = buffer.indexOf("\n")
    while (newline !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, "")
      buffer = buffer.slice(newline + 1)
      if (line) onLine(line)
      newline = buffer.indexOf("\n")
    }
  })
}

/**
 * Serves `attach` on a fresh private endpoint (directory 0700, secret 0600) until `close()` or the attach ends.
 * Each connection that proves the secret gets the session; the device service's attach stays open across reconnects.
 */
export async function serveRemoteAttach(
  attach: RemoteAttach,
  options: { readonly label: string; readonly platform?: NodeJS.Platform; readonly parent?: string } = { label: "" },
): Promise<RemoteAttachEndpoint> {
  const platform = options.platform ?? process.platform
  const dir = mkdtempSync(join(options.parent ?? tmpdir(), "omo-ra-"))
  chmodSync(dir, 0o700)
  const socketPath = join(dir, `t-${randomBytes(8).toString("hex")}.sock`)
  const secret = randomBytes(SECRET_BYTES)
  writeFileSync(`${socketPath}.secret`, secret, { mode: 0o600 })
  const sockets = new Set<Socket>()
  const server: Server = createServer(socket => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.once("error", () => socket.destroy())
    authenticate(socket, secret, () => {
      const presentation = new Presentation(attach, options.label, socket)
      socket.once("close", () => presentation.stop())
      serveLines(socket, line => {
        let request: unknown
        try {
          request = JSON.parse(line)
        } catch {
          socket.destroy()
          return
        }
        if (isParsedRecord(request)) void presentation.answer(request)
      })
    })
  })
  const address = platform === "win32" ? pipeAddress(socketPath, secret) : socketPath
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(address, () => {
      server.off("error", reject)
      resolve()
    })
  })
  const removeDir = () => rmSync(dir, { recursive: true, force: true })
  process.once("exit", removeDir)
  let closing: Promise<void> | undefined
  const close = () =>
    (closing ??= new Promise<void>(resolve => {
      for (const socket of sockets) socket.destroy()
      server.close(() => {
        process.off("exit", removeDir)
        removeDir()
        resolve()
      })
    }))
  void attach.detached.then(() => {
    for (const socket of sockets) socket.end()
  })
  return { socketPath, sessionRef: attach.sessionId, close }
}
