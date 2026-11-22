import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer, type Server, type Socket } from "node:net"
import { tmpdir } from "node:os"
import { join, win32 } from "node:path"

import type { JsonObject, RemoteAttach } from "../device-service-core/src/index.ts"
import { isRecord, LOCAL_SESSION_ID, Presentation } from "./remote-attach-presentation"

export { LOCAL_SESSION_ID }

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

// A record JSON.parse produced holds only JSON values, so an object from one line is a JsonObject.
const isParsedRecord = (value: unknown): value is JsonObject => isRecord(value)

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
  const server: Server = createServer((socket) => {
    sockets.add(socket)
    socket.once("close", () => sockets.delete(socket))
    socket.once("error", () => socket.destroy())
    authenticate(socket, secret, () => {
      const presentation = new Presentation(attach, options.label, socket)
      socket.once("close", () => presentation.stop())
      serveLines(socket, (line) => {
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
    (closing ??= new Promise<void>((resolve) => {
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
