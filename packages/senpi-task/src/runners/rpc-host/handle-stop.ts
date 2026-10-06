import type { ChildExitOutcome } from "../types"
import { sessionExitFacts } from "./exit-mapping"
import type { HostSessionPort } from "./handle-port"
import { endSessionOnHost } from "./handle-teardown"
import { TRANSPORT_LOST_REASON } from "./transport-recovery"

const STOPPED_UNREACHED_REASON = "cancelled while its task host was unreachable"

export interface HandleStopHost {
  readonly taskId: string
  readonly closeGraceMs: number
  port(): HostSessionPort
  exited(): boolean
  detached(): boolean
  recovering(): boolean
  markAborted(): void
  /** The teardown the child is under: a plain close() keeps its clean close when a late reattach ends it. */
  intent(): "running" | "closed" | "terminated"
  settleClosed(): void
  settleExit(outcome: ChildExitOutcome): void
  waitForExit(): Promise<ChildExitOutcome>
}

export interface HandleStop {
  requested(): boolean
  markStopping(): void
  endOnHost(client: HostSessionPort): Promise<void>
  stopUnreached(): void
  /** The bound ran out before the host took the continuation: lost, and the reopened session ends. */
  lostOnReopen(): void
  recoveryEnded(adopted: boolean): void
  stopWhenReachable(): Promise<void>
}

/**
 * The handle's side of task_cancel (omo#9403). Once a cancel is accepted the child is stopping: no
 * transport recovery brings it back, a session a recovery reopens is ended on its host, and a stop is
 * never left waiting on a recovery that ended without applying it - without a recovered port the child
 * stops on this side. A detached child (its parent shut down) is not this process's to stop: its
 * record carries the cancel to whichever revival reaches it next.
 */
export function createHandleStop(host: HandleStopHost): HandleStop {
  let requested = false

  // A cancel or terminate ends the session as terminated; a plain close() that a recovery overlapped
  // still ends as the clean close it asked for.
  const endOnHost = async (client: HostSessionPort): Promise<void> => {
    const kind = requested || host.intent() !== "closed" ? "terminated" : "closed"
    await endSessionOnHost({ taskId: host.taskId, closeGraceMs: host.closeGraceMs, port: () => client }, kind)
    if (kind === "closed") host.settleClosed()
    else host.settleExit({ kind: "killed", facts: sessionExitFacts("terminated") })
  }
  const stopUnreached = (): void => host.settleExit({ kind: "killed", facts: sessionExitFacts(STOPPED_UNREACHED_REASON) })
  const markStopping = (): void => {
    host.markAborted()
    requested = true
  }

  return {
    requested: () => requested,
    markStopping,
    endOnHost,
    stopUnreached,
    lostOnReopen: () => {
      const reopened = host.port()
      host.settleExit({ kind: "crashed", facts: sessionExitFacts(TRANSPORT_LOST_REASON) })
      void endSessionOnHost({ taskId: host.taskId, closeGraceMs: host.closeGraceMs, port: () => reopened }, "terminated")
    },
    recoveryEnded: (adopted) => {
      if (!requested || host.exited() || host.detached()) return
      if (adopted) void endOnHost(host.port())
      else stopUnreached()
    },
    stopWhenReachable: async () => {
      // Marked first: a transport that drops while the session is being ended must find the stop
      // already recorded, so the recovery it starts ends the child instead of resuming it.
      markStopping()
      if (!host.recovering()) return await endOnHost(host.port())
      await host.waitForExit()
    },
  }
}
