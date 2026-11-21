import { createConnection } from "node:net"

import { RunnerError } from "../in-process/runner-error"
import { HostSessionOpenError, SessionHeldElsewhereError } from "./session-wire"

export const BUSY_HOST_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000]

const BUSY_HOST_NOTE =
  "host_busy - the task host accepts connections but its event loop is not answering; waiting to start task children"

export type BusyHostAttempt<T> = (reopening: boolean) => Promise<T>

export type BusyHostWaitOptions = {
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<void>
  readonly waitMs: number
  readonly onWarning: (message: string) => void | (() => void)
  /** Whether the host socket still accepts a connection; defaults to a real connect. */
  readonly socketAccepts?: (socketPath: string) => Promise<boolean>
}

/**
 * A slow host is not a dead host (omo#9067). While the host's socket still accepts, a start that met
 * its blocked loop - the ensure refused `host_busy`, or an `open_session` the host never got to
 * acknowledge - is attempted again at the SAME session path until `waitMs` runs out. The host attaches
 * an open for a path it already hosts, so an earlier open it processes late is adopted, never
 * duplicated; while that earlier open is still being built the path answers `session_path_in_use`,
 * which inside such an episode means "not yet", not "held by someone else". A dead host (transport
 * gone, socket refused) is never retried: it fails the attempt at once, exactly as before.
 *
 * Two more starts are transient (omo#14538): a draining host (`host_draining`; the next attempt
 * re-resolves the endpoint), and a connection the host ended before it answered - at connect or
 * during `open_session` - while its socket still accepts. A host whose loop stalls past its internal
 * hop's auth budget destroys the connections made meanwhile without a coded answer. A cut during
 * `open_session` reopens the same path, since the host may have built the session already.
 */
export async function waitOutBusyHost<T>(attempt: BusyHostAttempt<T>, options: BusyHostWaitOptions): Promise<T> {
  const deadline = options.now() + options.waitMs
  let reopening = false
  let noted = false
  let clearNote: (() => void) | undefined
  try {
    for (let retry = 0; ; retry += 1) {
      try {
        return await attempt(reopening)
      } catch (error) {
        const busy = await busyHostCause(error, reopening, options.socketAccepts ?? socketAcceptsConnection)
        const delayMs = BUSY_HOST_BACKOFF_MS[Math.min(retry, BUSY_HOST_BACKOFF_MS.length - 1)] ?? 0
        if (busy === undefined || options.now() + delayMs > deadline) throw error
        if (busy === "open_timed_out" || busy === "cut_during_open") reopening = true
        if (!noted) {
          noted = true
          const cleanup = options.onWarning(BUSY_HOST_NOTE)
          if (cleanup !== undefined) clearNote = cleanup
        }
        await options.sleep(delayMs)
      }
    }
  } finally {
    clearNote?.()
  }
}

type BusyHostCause =
  | "host_busy"
  | "open_timed_out"
  | "session_path_in_use"
  | "host_draining"
  | "cut_at_connect"
  | "cut_during_open"

async function busyHostCause(
  error: unknown,
  reopening: boolean,
  socketAccepts: (socketPath: string) => Promise<boolean>,
): Promise<BusyHostCause | undefined> {
  if (!RunnerError.is(error)) return undefined
  const { kind, reason } = error.failure
  if (kind === "host_unavailable" && reason === "host_busy") return "host_busy"
  if (kind !== "session_unavailable") return undefined
  if (reason === "open_timed_out") return "open_timed_out"
  if (reason === "session_path_in_use" && reopening) return "session_path_in_use"
  if (reason === "host_draining") return "host_draining"
  const { open_step: step, host_socket: socket, cause } = error.failure
  if (reason !== undefined || socket === undefined || answeredByHost(cause)) return undefined
  if (step !== "connect" && step !== "open_session") return undefined
  if (!(await socketAccepts(socket))) return undefined
  return step === "connect" ? "cut_at_connect" : "cut_during_open"
}

/** A coded refusal is the host's answer, never a cut connection, whatever its code. */
function answeredByHost(cause: unknown): boolean {
  return (
    cause instanceof HostSessionOpenError ||
    cause instanceof SessionHeldElsewhereError ||
    (cause instanceof Error && cause.name === "RpcCommandError")
  )
}

/**
 * Whether something still ACCEPTS a connection on the host socket. The kernel completes a Unix
 * socket connect from the listen backlog without the host's event loop, so a live host with a
 * blocked loop answers yes while a dead one (refused, or no socket entry) answers no.
 */
export function socketAcceptsConnection(socketPath: string, timeoutMs = 2_000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath)
    const finish = (accepted: boolean): void => {
      clearTimeout(timer)
      socket.destroy()
      resolve(accepted)
    }
    const timer = setTimeout(() => finish(false), timeoutMs)
    socket.once("connect", () => finish(true))
    socket.once("error", () => finish(false))
  })
}
