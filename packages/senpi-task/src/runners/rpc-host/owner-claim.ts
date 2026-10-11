import type { EnsureHostInput, TaskDaemonHostPort } from "../../lazy/senpi-barrel"
import { log } from "@oh-my-opencode/utils"

import { isOwnerClaimRefusal } from "./ensure-failure"

type EnsuredHost = Awaited<ReturnType<TaskDaemonHostPort["ensureHost"]>>

const reportedSockets = new Set<string>()

/**
 * Ensures the host with an `owner: "caller"` claim, and attaches without one when senpi refuses the
 * claim on a host that is already running: one started by an engine before owner lifetimes, or one
 * another live process owns (the same session open in two terminals). That host keeps its own
 * idle policy, which is the pre-claim behaviour, so the task spawn still gets its endpoint.
 */
export async function ensureHostClaimingOwner(host: TaskDaemonHostPort, request: EnsureHostInput): Promise<EnsuredHost> {
  if (request.owner === undefined) return host.ensureHost(request)
  try {
    return await host.ensureHost(request)
  } catch (error) {
    if (!isOwnerClaimRefusal(error)) throw error
    if (!reportedSockets.has(request.socket)) {
      reportedSockets.add(request.socket)
      log("senpi-task host refused the owner claim; attaching without it", {
        socket: request.socket,
        reason: (error as Error).message,
      })
    }
    const { owner: _claimed, ...unowned } = request
    return host.ensureHost(unowned)
  }
}
