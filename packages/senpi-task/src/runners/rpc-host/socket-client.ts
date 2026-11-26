import { createHash, randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createConnection, type Socket } from "node:net"
import { win32 } from "node:path"
import { StringDecoder } from "node:string_decoder"
import { isReadCommand, readRpcDiagnostic } from "./read-rpc-diagnostic"
import type { RpcObject, RpcRequest } from "./socket-auth"

export { authenticateRpcHost, authRequiredError, RpcIdentityError } from "./socket-auth"
export type { RpcObject, RpcRequest } from "./socket-auth"

const WINDOWS_PIPE_PREFIX = "\\\\.\\pipe\\senpi-rpc-"
const WINDOWS_SECRET_BYTES = 32

export async function resolveRpcSocketTransport(
  endpoint: string,
): Promise<{ readonly address: string; readonly secret?: Buffer } | undefined> {
  if (process.platform !== "win32") return { address: endpoint }
  let secret: Buffer
  try {
    secret = await readFile(`${endpoint}.secret`)
  } catch {
    return undefined
  }
  if (secret.length !== WINDOWS_SECRET_BYTES) return undefined
  const canonical = win32.normalize(endpoint).toLowerCase()
  const name = createHash("sha256")
    .update(Buffer.concat([Buffer.from(canonical, "utf8"), secret]))
    .digest("hex")
    .slice(0, 32)
  return { address: `${WINDOWS_PIPE_PREFIX}${name}`, secret }
}

/**
 * A correlated JSONL conversation; broadcasts never settle a request and cleanup owns the socket. `listen` receives
 * every other frame (a subscription's records) and, once, the failure that ended the connection.
 *
 * Its deadline is the host's time, not the caller's (#14444): while this process's own event loop is blocked (another
 * tool's synchronous work in the same engine), no host can be heard, so that time is never charged to the host. A
 * terminal drops a connection whose secret has not arrived within its handshake window (senpi
 * `SOCKET_HANDSHAKE_TIMEOUT_MS`), which a blocked caller cannot send; a read (`isReadCommand`) that lost its connection
 * that way (the host dropped it before any response byte, after a stall that began after the dial, while the caller had
 * written nothing yet or had not yet run on time again), with budget left, is dialed once more. Nothing else is retried.
 */
export async function withRpcSocket<T>(
  endpoint: string,
  options: {
    readonly timeoutMs: number
    readonly readCommand?: unknown
    readonly secret?: Uint8Array
    readonly connect?: (endpoint: string) => Socket
    readonly listen?: { readonly frame: (frame: RpcObject) => void; readonly closed: (error: Error) => void }
  },
  operation: (request: RpcRequest) => Promise<T>,
): Promise<T> {
  const diagnostic = readRpcDiagnostic(options.readCommand)
  const redial = options.listen === undefined && isReadCommand(options.readCommand)
  // One budget for the whole call (#14624 review M1): a redial gets what is left of options.timeoutMs, never a fresh one.
  const meter = callerStallMeter()
  const deadline = performance.now() + options.timeoutMs
  try {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await converse(endpoint, options, operation, meter, diagnostic, deadline)
      } catch (error) {
        const lost = error instanceof Error ? lostConnections.get(error) : undefined
        // A reset handled before an already-due timeout callback must not open a second socket once the budget is gone.
        const budgetLeft = performance.now() < deadline + meter.total()
        if (redial && attempt === 1 && lost?.duringStall === true && budgetLeft) {
          diagnostic?.redialed()
          continue
        }
        // Only failures a socket recorded (connect, close, timeout) are transport failures; the operation's own throws are not.
        if (error instanceof Error && transportFailures.has(error)) diagnostic?.failed(error, meter.total())
        throw error
      }
    }
  } finally {
    meter.pause()
  }
}

/** How often a conversation looks at its own clock, and how late a look may be before the gap counts as a stall. */
const STALL_PROBE_MS = 50
const STALL_TOLERANCE_MS = 50

type CallerStallMeter = {
  /** Records the gap since the last look; the milliseconds this process could not run its event loop so far. */
  total(): number
  /** How many stalls were seen so far (each look that found one), counting the gap up to now. */
  stalls(): number
  /** Whether an on-time probe ran after the last stall: the caller has been running again since (#14624 review M5). */
  recovered(): boolean
  /** Stops looking while nothing waits on the clock (a subscription between requests); the gap is never counted. */
  pause(): void
  resume(): void
}

/**
 * Milliseconds this process's event loop was blocked while a conversation was waiting on the clock: every look later than
 * its period plus the tolerance adds the excess. A conversation's deadline is moved by exactly that much.
 */
function callerStallMeter(): CallerStallMeter {
  let stalled = 0
  let last = performance.now()
  let stallCount = 0
  let recovered = true
  let lastProbe = last
  let probe: ReturnType<typeof setInterval> | undefined
  const look = (probeTick = false) => {
    const now = performance.now()
    const excess = Math.max(0, now - last - STALL_PROBE_MS - STALL_TOLERANCE_MS)
    if (excess > 0) {
      stalled += excess
      stallCount += 1
      recovered = false
    }
    if (probeTick) {
      // Only a probe on time proves the caller runs again, and on time is measured from the previous probe: an overdue
      // probe that runs right after some other clock read (a request arming its timer) is not one (#14624 review M5).
      if (excess === 0 && now - lastProbe <= STALL_PROBE_MS + STALL_TOLERANCE_MS) recovered = true
      lastProbe = now
    }
    last = now
    return stalled
  }
  const resume = () => {
    if (probe !== undefined) return
    last = performance.now()
    lastProbe = last
    probe = setInterval(() => look(true), STALL_PROBE_MS)
    probe.unref?.()
  }
  resume()
  return {
    total: () => (probe === undefined ? stalled : look()),
    stalls: () => {
      if (probe !== undefined) look()
      return stallCount
    },
    recovered: () => recovered,
    pause: () => {
      if (probe === undefined) return
      look()
      clearInterval(probe)
      probe = undefined
    },
    resume,
  }
}

const transportFailures = new WeakSet<Error>()
/** Transport failures that lost the connection before any response byte, with the caller stall seen until then. */
const lostConnections = new WeakMap<Error, { readonly duringStall: boolean }>()
/**
 * Socket errors that mean the host side dropped the connection (#14624 review M2). Anything else (EACCES, ETIMEDOUT, a
 * refused connect) is not evidence that the host cut the handshake, so it is never redialed.
 */
const HOST_DROPS: ReadonlySet<string> = new Set(["ECONNRESET", "EPIPE"])

async function converse<T>(
  endpoint: string,
  options: Parameters<typeof withRpcSocket<T>>[1],
  operation: (request: RpcRequest) => Promise<T>,
  meter: CallerStallMeter,
  diagnostic: ReturnType<typeof readRpcDiagnostic>,
  deadline: number,
): Promise<T> {
  // A host drop is this conversation's stall only if a stall began after the dial. Before the caller wrote anything, the
  // host can only have given up on a silent caller, however late its reset is seen; once the caller wrote, a probe on time
  // after the stall proves it ran again, so a later reset is not the stall's (#14624 review M5).
  const stallsAtDial = meter.stalls()
  let wrote = false
  let socket: Socket
  try {
    socket = (options.connect ?? createConnection)(endpoint)
  } catch (error) {
    if (error instanceof Error) transportFailures.add(error)
    throw error
  }
  const decoder = new StringDecoder("utf8")
  let buffer = ""
  let answered = false
  let pending: { id: unknown; resolve: (frame: RpcObject) => void; reject: (error: Error) => void } | undefined
  let failure: Error | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  let rejectConnect: (error: Error) => void = () => undefined
  // A deadline is never redialed: the host had its whole budget of this process's running time.
  const fail = (error: Error, droppedByHost = true) => {
    transportFailures.add(error)
    if (droppedByHost && !answered) {
      const stalled = meter.stalls() > stallsAtDial
      lostConnections.set(error, { duringStall: stalled && (!wrote || !meter.recovered()) })
    }
    if (failure === undefined) options.listen?.closed(error)
    failure = error
    clear()
    rejectConnect(error)
    pending?.reject(error)
    pending = undefined
  }
  // The call's deadline (withRpcSocket) bounds the whole conversation (connect, handshake and request) and a step's own
  // budget can only shorten what is left of it, both on a monotonic clock that stops while this process's event loop is blocked.
  const arm = (timeoutMs: number) => {
    clear()
    meter.resume()
    const armedAt = performance.now()
    const stalledAtArm = meter.total()
    const due = () => {
      const stalled = meter.total()
      return Math.min(deadline + stalled, armedAt + timeoutMs + stalled - stalledAtArm)
    }
    const wait = () => {
      timer = setTimeout(
        () => {
          if (due() > performance.now()) return wait()
          fail(new Error("thread RPC request timed out"), false)
          socket.destroy()
        },
        Math.max(0, due() - performance.now()),
      )
    }
    wait()
  }
  socket.once("error", (error: Error) => {
    const code = "code" in error ? error.code : undefined
    fail(error, typeof code === "string" && HOST_DROPS.has(code))
  })
  socket.once("close", () => fail(new Error("thread RPC connection closed before the response arrived")))
  socket.on("data", (chunk: Buffer) => {
    answered = true
    diagnostic?.at("response-bytes")
    buffer += decoder.write(chunk)
    for (let newline = buffer.indexOf("\n"); newline >= 0; newline = buffer.indexOf("\n")) {
      diagnostic?.at("response-frame")
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      if (line.trim() === "") continue
      let frame: unknown
      // A line that is not JSON (stray host output) is never the reply; it is skipped like a broadcast.
      try {
        frame = JSON.parse(line)
      } catch {
        continue
      }
      if (typeof frame !== "object" || frame === null) continue
      if (!("id" in frame) || frame.id !== pending?.id) {
        options.listen?.frame(frame as RpcObject)
        continue
      }
      const waiter = pending
      pending = undefined
      clear()
      // A subscription between requests waits only for frames, so nothing needs the clock (#14624 review L2).
      if (options.listen !== undefined) meter.pause()
      waiter?.resolve(frame as RpcObject)
    }
  })
  const request: RpcRequest = async (command, timeoutMs = options.timeoutMs) => {
    if (failure !== undefined) throw failure
    return await new Promise<RpcObject>((resolve, reject) => {
      const id = command.id ?? randomUUID()
      pending = { id, resolve, reject }
      arm(timeoutMs)
      diagnostic?.at(command.type === options.readCommand ? "request" : "handshake")
      wrote = true
      socket.write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }
  try {
    await new Promise<void>((resolve, reject) => {
      rejectConnect = reject
      arm(options.timeoutMs)
      socket.once("connect", () => {
        clear()
        diagnostic?.at(options.secret === undefined ? "connected" : "handshake")
        if (options.secret !== undefined) {
          wrote = true
          socket.write(Buffer.from(options.secret))
        }
        resolve()
      })
    })
    return await operation(request)
  } finally {
    clear()
    socket.destroy()
  }
}
