import { log } from "@oh-my-opencode/utils"

import type { HostSessionIdentity, HostSessionPort } from "./handle-port"
import { type HostSessionReattach, type HostSessionReattached, reattachContinuationPrompt } from "./reattach"

export interface ReattachSubject {
  readonly taskId: string
  readonly session: () => HostSessionIdentity
  readonly alive: () => boolean
  readonly turnInFlight: () => boolean
  readonly adopt: (next: HostSessionReattached) => void
  readonly continueTurn: (prompt: string) => Promise<void>
  readonly giveUp: () => void
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
  let next: HostSessionReattached | undefined
  try {
    next = await reattach(lost)
  } catch (error) {
    log("senpi-task host session reattach failed", { taskId: subject.taskId, error: String(error) })
  }
  if (!subject.alive()) {
    if (next !== undefined) await discard(next.client, subject.taskId)
    return
  }
  if (next === undefined) {
    subject.giveUp()
    return
  }
  subject.adopt(next)
  log("senpi-task host session reattached", {
    taskId: subject.taskId,
    sessionPath: next.session.sessionPath,
    attached: next.attached,
    turnWasInFlight,
  })
  if (!turnWasInFlight) return
  if (next.attached && (await stillStreaming(next.client, subject.taskId))) return
  await subject.continueTurn(reattachContinuationPrompt())
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
