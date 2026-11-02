import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, win32 } from "node:path"

import type { RemoteAttach, RemoteAttachEvent, SnapshotBody } from "../device-service-core/src/index.ts"

// `omo remote attach` serves one remote session to the engine's unchanged attach TUI (`--attach <socket> --session
// <ref>`): a private endpoint that speaks the RPC subset the TUI uses, answered from the device service's attach.
// The TUI authenticates a `t-<16 hex>.sock` endpoint with the 32-byte secret beside it on every platform, and on
// Windows reaches the named pipe derived from that path and secret, so this endpoint follows the same two rules.
// Phase 1 observes only: every input the TUI can send is refused with REMOTE_INPUT_OFF.

export const REMOTE_INPUT_OFF = "remote input not enabled yet: this view is observe-only"
const SECRET_BYTES = 32
const HANDSHAKE_TIMEOUT_MS = 2_000
const MAX_LINE_CHARS = 64 * 1024 * 1024
const PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
/** The session id this endpoint presents; the remote engine's own id is never needed by the TUI. */
export const LOCAL_SESSION_ID = "remote"

type Json = Record<string, unknown>
const INPUT_COMMANDS = new Set(["prompt", "steer", "follow_up", "abort", "bash", "compact", "new_session", "switch_session"])

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
    this.notify(`Observing ${this.label}: ${REMOTE_INPUT_OFF}`, "info")
    this.stopStream = this.attach.onEvent(event => this.event(event))
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

  async answer(request: Json): Promise<void> {
    const type = String(request.type)
    const reply = (data: Json = {}) => this.send({ type: "response", id: request.id, command: type, success: true, data })
    const refuse = (error: string) => this.send({ type: "response", id: request.id, command: type, success: false, error })
    try {
      switch (type) {
        case "set_client_info":
        case "attach_session":
        case "release_attachment":
          return reply()
        case "list_sessions":
          return reply({
            sessions: [{ sessionId: LOCAL_SESSION_ID, durableSessionId: this.attach.sessionId, retain_on_disconnect: true, sessionName: this.label }],
          })
        case "subscribe_sessions":
          reply({ subscriptionId: randomUUID(), snapshot: [] })
          return this.startStream()
        case "get_state": {
          const snapshot = this.snapshot ?? (await this.attach.snapshot)
          this.snapshot = snapshot
          return reply(stateOf(snapshot))
        }
        case "get_entries":
          return reply(await this.entries(request))
        case "extension_ui_response":
          return refuse(REMOTE_INPUT_OFF)
        default:
          return refuse(INPUT_COMMANDS.has(type) ? REMOTE_INPUT_OFF : `${type} is not available on a remote session`)
      }
    } catch (error) {
      refuse(error instanceof Error ? error.message : String(error))
    }
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
        if (isRecord(request)) void presentation.answer(request)
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
