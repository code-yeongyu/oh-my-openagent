import { log } from "@oh-my-opencode/utils"
import type { HostSessionFacts, HostSessionPort } from "./handle-port"
import type { HostSessionReattach, HostSessionReattached } from "./reattach"
import { HostSessionDetachedError, HostSessionUnresponsiveError } from "./session-wire"
import { armRecoveryBound, withinBound } from "./transport-recovery"

/** Reacquire only this session to close it; never resume a turn or signal its shared host. */
export function createUnresponsiveClose(input: {
  readonly taskId: string
  readonly closeGraceMs: number
  readonly reattach: HostSessionReattach | undefined
  port(): HostSessionPort
  session(): HostSessionFacts
  stopped(): boolean
  adopt(next: HostSessionReattached): void
}) {
  let disconnected = false
  let reopened = false
  let reconnecting: Promise<void> | undefined
  const stopped = Promise.withResolvers<undefined>()
  const reconnect = async (): Promise<void> => {
    const next = await input.reattach?.(input.session(), input.stopped)
    if (next === undefined || "refused" in next) throw new HostSessionDetachedError("close_session")
    if (input.stopped()) return await next.client.detach()
    input.adopt(next)
    reopened = !next.attached
    disconnected = false
  }
  const connect = async (): Promise<void> => {
    if (!disconnected) return
    reconnecting ??= reconnect().finally(() => { reconnecting = undefined })
    await reconnecting
  }
  const closePort = (port: HostSessionPort): Promise<void> => {
    if (port.closeConfirmed === undefined) return Promise.reject(new HostSessionUnresponsiveError())
    return port.closeConfirmed()
  }
  return {
    stop: () => { stopped.resolve(undefined) },
    transportLost: () => { disconnected = true },
    probe: async () => {
      await connect()
      const port = input.port()
      // Reopening a transcript is not recovering the original live session. Do not re-prompt it.
      if (reopened) {
        await closePort(port)
        throw Object.assign(new Error("unknown_session"), { errorCode: "unknown_session" })
      }
      return await port.getState()
    },
    close: async (): Promise<void> => {
      await connect()
      if (input.stopped()) return
      const port = input.port()
      const bound = armRecoveryBound({ boundMs: Math.min(input.closeGraceMs, 2_000) })
      try { await Promise.race([withinBound(bound, port.send({ type: "abort" })), stopped.promise]) }
      catch (error) { log("senpi-task unresponsive session abort pending", { taskId: input.taskId, error: String(error) }) }
      finally { bound.settle() }
      if (input.stopped()) return
      // Parent shutdown's best-effort helper swallows this failure. Liveness cannot.
      await Promise.race([closePort(port), stopped.promise])
    },
  }
}
