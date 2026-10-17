import { log } from "@oh-my-opencode/utils"

import type { RpcRunnerSpec } from "../types"
import {
  admitChildStore,
  ensureChildEndpoint,
  isStoreIndexUnavailable,
  type ChildEndpointPorts,
} from "./child-endpoint"
import { isHostIncompatible } from "./daemon"
import type { HostSessionFacts, HostSessionPort } from "./handle-port"
import { attachOnlyEndpoint } from "./own-endpoint"
import type { HostSessionReattach, HostSessionReattached, HostSessionReattachRefused } from "./reattach"
import type { OpenedHostSession } from "./session-client"

export interface ReattachPortInput<Port extends HostSessionPort> {
  readonly endpoint: ChildEndpointPorts
  readonly spec: RpcRunnerSpec
  readonly delaysMs: readonly number[]
  readonly sleep: (ms: number) => Promise<void>
  readonly createClient: (socket: string) => Port
  readonly open: (client: Port, sessionPath: string) => Promise<OpenedHostSession>
}

/**
 * Transport recovery for one child: re-ensure the RECORDED endpoint (never a re-derived one) and
 * reopen the same session path there, with backoff. An incompatible answer parks the child - its
 * session is never moved to another endpoint - and the session's own endpoint is only ever
 * re-opened, never ensured: if it stays silent the child parks as `own_host_unreachable`.
 */
export function createReattachPort<Port extends HostSessionPort>(input: ReattachPortInput<Port>): HostSessionReattach {
  return async (lost: HostSessionFacts): Promise<HostSessionReattached | HostSessionReattachRefused | undefined> => {
    const { endpoint, spec } = input
    for (const delayMs of input.delaysMs) {
      await input.sleep(delayMs)
      try {
        await admitChildStore(endpoint)
        const socket = await ensureChildEndpoint(endpoint, { socket: lost.socket, recorded: true, attachOnly: false })
        const client = input.createClient(socket)
        const opened = await input.open(client, lost.sessionPath)
        return {
          client,
          session: { routingId: opened.sessionId, sessionPath: lost.sessionPath, instanceId: opened.instanceId },
          attached: opened.attached,
        }
      } catch (error) {
        if (isStoreIndexUnavailable(error)) return { refused: "store_index_unavailable" }
        if (isHostIncompatible(error)) {
          endpoint.notice("host_incompatible", lost.socket)
          return { refused: "host_incompatible" }
        }
        log("senpi-task host session reattach attempt failed", { taskId: spec.task_id, error: String(error) })
      }
    }
    if (!attachOnlyEndpoint(lost.socket, endpoint.ownHostSocket(), endpoint.insideHost())) return undefined
    endpoint.notice("own_host_unreachable", lost.socket)
    return { refused: "own_host_unreachable" }
  }
}
