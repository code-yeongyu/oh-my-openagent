import { log } from "@oh-my-opencode/utils"

import type { HostSessionFacts, HostSessionPort } from "./handle-port"
import type { HostParkReason } from "./session-client"
import {
  type HostSessionReattach,
  type HostSessionReattached,
  type HostSessionReattachRefused,
  reattachContinuationPrompt,
} from "./reattach"

/**
 * How ONE child's recovery ended: re-joined live, reopened idle, re-prompted mid-turn, gone, or
 * `cancelled` - the child itself left (cancelled, closed, detached) before recovery finished.
 */
export type ReattachOutcome = "attached" | "resumed" | "continued" | "lost" | "host_incompatible" | "cancelled"

export interface TransportLostInfo {
  readonly taskId: string
  readonly socket: string
  // The host generation the child lost: every sibling that lost the same one shares one crash.
  readonly instanceId: string
  readonly turnWasInFlight: boolean
  // Filled by the runner: every live child still bound to this socket + instanceId (this one too).
  readonly boundTaskIds?: readonly string[]
  // Filled by the runner when it ensured this very generation: its supervisor's pid.
  readonly supervisorPid?: number
}

export interface ReattachOutcomeInfo {
  readonly taskId: string
  readonly socket: string
  readonly outcome: ReattachOutcome
  readonly newInstanceId?: string
}

/**
 * An observer of recovery episodes (the parent's crash notice). It is told once when a child starts
 * recovering and once when that recovery ends; it never changes what recovery does.
 */
export interface HostShardEvents {
  onTransportLost?(info: TransportLostInfo): void
  onReattachOutcome?(info: ReattachOutcomeInfo): void
}

export interface ReattachSubject extends HostShardEvents {
  readonly taskId: string
  readonly session: () => HostSessionFacts
  readonly alive: () => boolean
  readonly turnInFlight: () => boolean
  readonly adopt: (next: HostSessionReattached) => void
  // A turn in flight at the loss runs again on the new port: re-joined still streaming, or re-prompted.
  readonly turnResumed: () => void
  readonly continueTurn: (prompt: string) => Promise<void>
  readonly giveUp: (refusal?: HostParkReason) => void
}

/**
 * Recover ONE lost transport. The host either kept the session (a connection cut - re-join it
 * and let the running turn deliver its events over the new port) or reopened it from its JSONL
 * (the host died - the turn in flight is gone and is re-prompted). A turn the host finished
 * while the child was away is re-prompted too: its ending events never reached this handle.
 * Detached ports outlive this call only when the child already left; they are closed here.
 */
export async function recoverLostTransport(subject: ReattachSubject, reattach: HostSessionReattach): Promise<void> {
  const turnWasInFlight = subject.turnInFlight()
  const lost = subject.session()
  const { taskId } = subject
  observe(taskId, () => subject.onTransportLost?.({ taskId, socket: lost.socket, instanceId: lost.instanceId, turnWasInFlight }))
  const report = (outcome: ReattachOutcome, newInstanceId?: string): void =>
    observe(taskId, () =>
      subject.onReattachOutcome?.({ taskId, socket: lost.socket, outcome, ...(newInstanceId === undefined ? {} : { newInstanceId }) }),
    )
  let next: HostSessionReattached | HostSessionReattachRefused | undefined
  try {
    next = await reattach(lost)
  } catch (error) {
    log("senpi-task host session reattach failed", { taskId, error: String(error) })
  }
  if (!subject.alive()) {
    if (next !== undefined && !("refused" in next)) await discard(next.client, taskId)
    return report("cancelled")
  }
  if (next === undefined || "refused" in next) {
    report(next?.refused === "host_incompatible" ? "host_incompatible" : "lost")
    subject.giveUp(next?.refused)
    return
  }
  subject.adopt(next)
  log("senpi-task host session reattached", {
    taskId,
    sessionPath: next.session.sessionPath,
    attached: next.attached,
    turnWasInFlight,
  })
  const rejoined = next.attached ? "attached" : "resumed"
  if (!turnWasInFlight) return report(rejoined, next.session.instanceId)
  if (next.attached && (await stillStreaming(next.client, taskId))) {
    observe(taskId, subject.turnResumed)
    return report(rejoined, next.session.instanceId)
  }
  // A reopened session is not a resumed turn until the continuation actually lands. Reporting
  // before this await counted refused/timed-out deliveries as successful recoveries (omo#9403).
  try {
    await subject.continueTurn(reattachContinuationPrompt())
  } catch (error) {
    report(subject.alive() ? "lost" : "cancelled", next.session.instanceId)
    throw error
  }
  if (!subject.alive()) return report("cancelled", next.session.instanceId)
  observe(taskId, subject.turnResumed)
  report("continued", next.session.instanceId)
}

/** An observer that throws is logged, never allowed to change what recovery does next. */
function observe(taskId: string, notify: () => void): void {
  try {
    notify()
  } catch (error) {
    log("senpi-task host session reattach observer failed", { taskId, error: String(error) })
  }
}

async function stillStreaming(client: HostSessionPort, taskId: string): Promise<boolean> {
  try {
    const state = await client.getState()
    return state.isStreaming === true
  } catch (error) {
    log("senpi-task host session reattach state read failed", { taskId, error: String(error) })
    return false
  }
}

async function discard(client: HostSessionPort, taskId: string): Promise<void> {
  try {
    await client.detach()
  } catch (error) {
    log("senpi-task host session reattach discard failed", { taskId, error: String(error) })
  }
}
