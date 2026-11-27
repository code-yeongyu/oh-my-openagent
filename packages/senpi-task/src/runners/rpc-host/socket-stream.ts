import { randomUUID } from "node:crypto"
import { createConnection, type Socket } from "node:net"
import { createJsonlLines, parseJsonObjectLine } from "./jsonl-lines"
import { authenticateRpcHost, authRequiredError, type RpcObject } from "./socket-auth"
import { resolveRpcSocketTransport } from "./socket-transport"

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
// A connect failure that means nothing serves the endpoint: no socket there, or a stale one its host left behind.
const NOT_RUNNING: ReadonlySet<unknown> = new Set(["ENOENT", "ECONNREFUSED"])

export class RpcStreamError extends Error {
  constructor(
    readonly code: "not_running" | "closed" | "request_timeout",
    detail: string,
  ) {
    super(`${code}: ${detail}`)
  }
}

/** Arms `fire` after `ms` and answers the function that disarms it: the clock a test replaces. */
export type Schedule = (fire: () => void, ms: number) => () => void

export type RpcSocketStreamOptions = {
  /** Where the endpoint's key records live (`<keyRoot>/rpc/keys`), as `authenticateRpcHost` reads them. */
  readonly keyRoot: string | (() => string)
  /** Every frame that does not answer one of this stream's own requests, in the order the host wrote it. */
  readonly onFrame: (frame: RpcObject) => void
  /**
   * Once, when an opened connection ends for any reason, after every pending request was refused `closed`. A connection
   * lost while opening rejects the open instead.
   */
  readonly onClose: () => void
  readonly requestTimeoutMs?: number
  readonly connect?: (address: string) => Socket
  readonly schedule?: Schedule
}

/** One authenticated, long-lived JSONL connection to a host endpoint. */
export type RpcSocketStream = {
  /** Sends `command` under an id of this stream's own and settles with the host's `response` carrying that id. */
  readonly request: (command: RpcObject, timeoutMs?: number) => Promise<RpcObject>
  /** Writes one frame as is; whatever answers it arrives through `onFrame`. */
  readonly send: (frame: RpcObject) => void
  readonly close: () => void
}

const realSchedule: Schedule = (fire, ms) => {
  const timer = setTimeout(fire, ms)
  timer.unref?.()
  return () => clearTimeout(timer)
}

async function dial(endpoint: string, connect: (address: string) => Socket): Promise<Socket> {
  const transport = await resolveRpcSocketTransport(endpoint)
  if (transport === undefined) throw new RpcStreamError("not_running", `no host endpoint answers at ${endpoint}`)
  const socket = connect(transport.address)
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve)
    socket.once("error", reject)
  }).catch((error: unknown) => {
    socket.destroy()
    const code = error instanceof Error && "code" in error ? error.code : undefined
    if (NOT_RUNNING.has(code))
      throw new RpcStreamError("not_running", `no host answers at ${endpoint}: ${String(code)}`)
    throw error
  })
  if (transport.secret !== undefined) socket.write(transport.secret)
  return socket
}

/**
 * Dials a host endpoint and authenticates (senpi docs/rpc.md "Authentication"; a Windows pipe proves itself by its
 * secret instead). Frames are strict JSONL; only a `response` whose id this stream issued settles a request, so another
 * client's answer or a broadcast never does. Each request has its own deadline and the connection has none.
 */
export async function openRpcSocketStream(
  endpoint: string,
  {
    keyRoot,
    onFrame,
    onClose,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    connect = createConnection,
    schedule = realSchedule,
  }: RpcSocketStreamOptions,
): Promise<RpcSocketStream> {
  const socket = await dial(endpoint, connect)
  type Waiter = { readonly resolve: (reply: RpcObject) => void; readonly reject: (error: Error) => void }
  const pending = new Map<string, Waiter & { readonly disarm: () => void }>()
  let closed = false
  let opened = false
  const lines = createJsonlLines()
  socket.on("data", (chunk: Buffer) => {
    for (const line of lines(chunk)) {
      // A line that is not a JSON object (a host's stray output) is no frame and is skipped.
      const frame = parseJsonObjectLine(line)
      if (frame === undefined) continue
      const id = frame.type === "response" && typeof frame.id === "string" ? frame.id : undefined
      const waiting = id === undefined ? undefined : pending.get(id)
      if (id === undefined || waiting === undefined) {
        onFrame(frame)
        continue
      }
      pending.delete(id)
      waiting.disarm()
      waiting.resolve(frame)
    }
  })
  socket.on("error", () => socket.destroy())
  socket.once("close", () => {
    closed = true
    for (const waiting of pending.values()) {
      waiting.disarm()
      waiting.reject(new RpcStreamError("closed", "the host connection closed"))
    }
    pending.clear()
    if (opened) onClose()
  })
  const request = (command: RpcObject, timeoutMs = requestTimeoutMs): Promise<RpcObject> => {
    if (closed) return Promise.reject(new RpcStreamError("closed", "the host connection closed"))
    return new Promise<RpcObject>((resolve, reject) => {
      const id = randomUUID()
      const disarm = schedule(() => {
        pending.delete(id)
        reject(new RpcStreamError("request_timeout", `${String(command.type)} got no answer within ${timeoutMs} ms`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, disarm })
      socket.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }
  if (process.platform !== "win32") {
    const info = await authenticateRpcHost(request, endpoint, keyRoot).catch((error: unknown) => {
      socket.destroy()
      throw error
    })
    if (info.success === false && (info.errorCode ?? info.error) === "auth_required") {
      socket.destroy()
      throw authRequiredError(endpoint)
    }
  }
  if (closed) throw new RpcStreamError("closed", "the host connection closed while opening")
  opened = true
  return {
    request,
    send: (frame) => {
      if (closed) throw new RpcStreamError("closed", "the host connection closed")
      socket.write(`${JSON.stringify(frame)}\n`)
    },
    close: () => {
      if (!closed) socket.end()
    },
  }
}
