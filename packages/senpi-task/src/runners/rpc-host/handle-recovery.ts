import type { HostSessionIdentity, HostSessionPort } from "./handle-port"
import { recoverLostTransport, type HostShardEvents } from "./handle-reattach"
import {
  isTransportLossError,
  type HostSessionReattach,
  type HostSessionReattached,
  type HostSessionReattachRefused,
} from "./reattach"
import type { HostParkReason, HostSessionCommand } from "./session-client"
import { armRecoveryBound, withinBound, type RecoveryBound, type TransportRecoveryOptions } from "./transport-recovery"

export interface HandleRecoveryHost {
  readonly taskId: string
  readonly reattach: HostSessionReattach | undefined
  readonly events: HostShardEvents | undefined
  readonly bound: TransportRecoveryOptions | undefined
  port(): HostSessionPort
  identity(): HostSessionIdentity
  alive(): boolean
  turnSettled(): boolean
  adopt(next: HostSessionReattached): void
  turnResumed(): void
  endLost(): void
  park(reason: HostParkReason): void
  /** The continuation that re-drives the in-flight turn after a reattach was not delivered. */
  continuationFailed(error: unknown): void
  /** A stop (cancel) was asked for while the transport was down: it runs before anything else. */
  stopRequested(): boolean
  endOnHost(client: HostSessionPort): Promise<void>
  /** The child stopped from this side without reaching its host (the bound ran out under a stop). */
  stopUnreached(): void
  /** A recovery ended, by any path; `adopted` says whether it left the child on a recovered port. */
  recoveryEnded(adopted: boolean): void
}

export interface HandleRecovery {
  issue(command: HostSessionCommand): Promise<void>
  onTransportGone(lost: HostSessionPort): void
  settled(): Promise<void>
  currentPort(): Promise<HostSessionPort>
  recovering(): boolean
}

type ReattachAnswer = HostSessionReattached | HostSessionReattachRefused | undefined

/**
 * The handle's transport recovery. A command never fails on a transport the child can recover from:
 * while a reattach is in flight it waits for the new port, and one that met the loss first lets
 * recovery start and is retried once on the port recovery produced. A command still being delivered
 * when the loss hits is NOT a turn the host lost - its retry is the delivery - so recovery's in-flight
 * verdict ignores turns while a delivery is pending, whichever reaction runs first.
 *
 * Every recovery is BOUNDED (omo#9403): when the bound runs out first the child ends `transport lost`
 * and whatever connection a late reattach still produces ends the session on the host, so the
 * child's processes go with it. A stop asked for while the transport is down is applied on the
 * recovered connection before anything else, and never continues the turn.
 */
export function createHandleRecovery(host: HandleRecoveryHost): HandleRecovery {
  let reattaching: Promise<void> | undefined
  let deliveries = 0

  const issue = async (command: HostSessionCommand): Promise<void> => {
    await reattaching
    const live = host.port()
    deliveries += 1
    try {
      await live.send(command)
    } catch (error) {
      if (!isTransportLossError(error) || host.reattach === undefined || !host.alive()) throw error
      await live.transportGone
      await reattaching
      if (!host.alive()) throw error
      await host.port().send(command)
    } finally {
      deliveries -= 1
    }
  }

  const endLate = (answer: ReattachAnswer): void => {
    if (answer === undefined || "refused" in answer) return
    void host.endOnHost(answer.client)
  }

  // The runner's reattach, raced against the bound. A connection that arrives after the child stopped
  // waiting for it (the bound ran out, or a stop was asked for) is never adopted: it ends the session.
  const boundedReattach = (reattach: HostSessionReattach, bound: RecoveryBound): HostSessionReattach => async (lost) => {
    const attempt = reattach(lost)
    const winner = await Promise.race([attempt, bound.expired])
    if (winner === "expired" || bound.isExpired()) {
      void attempt.then(endLate, () => undefined)
      if (host.stopRequested()) host.stopUnreached()
      return undefined
    }
    if (host.stopRequested() && winner !== undefined && !("refused" in winner)) {
      await host.endOnHost(winner.client)
      return undefined
    }
    return winner
  }

  // A lost transport is recoverable while this child still owns a running session and the runner
  // gave it a way back (omo#8563).
  const onTransportGone = (lost: HostSessionPort): void => {
    if (host.port() !== lost) return
    const reattach = host.reattach
    if (reattach === undefined) return host.endLost()
    if (!host.alive()) {
      // A child that already left still settles its place in a crash episode it was counted into.
      host.events?.onReattachOutcome?.({ taskId: host.taskId, socket: lost.socketPath, outcome: "cancelled" })
      return host.endLost()
    }
    const bound = armRecoveryBound(host.bound)
    let adopted = false
    reattaching = recoverLostTransport(
      {
        taskId: host.taskId,
        onTransportLost: (info) => host.events?.onTransportLost?.(info),
        onReattachOutcome: (info) => host.events?.onReattachOutcome?.(info),
        session: () => ({ socket: host.port().socketPath, ...host.identity() }),
        alive: () => host.alive() && !host.stopRequested(),
        turnInFlight: () => !host.turnSettled() && deliveries === 0,
        adopt: (next) => {
          adopted = true
          host.adopt(next)
        },
        turnResumed: host.turnResumed,
        // A stop recorded while the reattached session was being read must run before any continuation:
        // the turn is not re-driven, and the recovery's end stops the adopted session (omo#9403).
        continueTurn: async (prompt) => {
          if (host.stopRequested()) return
          await withinBound(bound, host.port().send({ type: "prompt", message: prompt, streamingBehavior: "steer" }))
        },
        // A refused reattach parks (the endpoint answered, but may not host this session); exhaustion ends.
        giveUp: (reason) => (reason === undefined ? host.endLost() : host.park(reason)),
      },
      boundedReattach(reattach, bound),
    )
      .catch((error: unknown) => host.continuationFailed(error))
      .finally(() => {
        bound.settle()
        reattaching = undefined
        host.recoveryEnded(adopted)
      })
  }

  return {
    issue,
    onTransportGone,
    settled: async () => await reattaching,
    currentPort: async () => {
      await reattaching
      return host.port()
    },
    recovering: () => reattaching !== undefined,
  }
}
