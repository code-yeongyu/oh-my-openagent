import type { HostEnginePolicy } from "../../lazy/senpi-barrel"
import type { HostEndpointPort } from "../../lifecycle/host-session"
import type { EnsureTaskDaemonPort } from "./child-endpoint"
import { ensureTaskDaemon, isHostIncompatible } from "./daemon"
import { onceNoticeSink, type HostNoticeSink } from "./host-notice"
import { attachOnlyEndpoint } from "./own-endpoint"

export interface HostEndpointPortInput {
  readonly agentDir: string
  readonly env: Readonly<Record<string, string | undefined>>
  readonly policy: HostEnginePolicy
  readonly ensureDaemon?: EnsureTaskDaemonPort
  readonly ownHostSocket: () => string | undefined
  readonly insideHost: () => boolean
  readonly onNotice: HostNoticeSink
}

/** The lifecycle's way to a recorded endpoint (`LifecycleDeps.hostEndpoint`), built from the runner's ports. */
export function createHostEndpointPort(input: HostEndpointPortInput): HostEndpointPort {
  const ensureDaemon = input.ensureDaemon ?? ensureTaskDaemon
  const notice = onceNoticeSink(input.onNotice)
  return {
    isOwn: (socket) => attachOnlyEndpoint(socket, input.ownHostSocket(), input.insideHost()),
    ensure: async (socket) => {
      try {
        await ensureDaemon({ agentDir: input.agentDir, env: input.env, policy: input.policy, socket })
        return "ensured"
      } catch (error) {
        return isHostIncompatible(error) ? "incompatible" : "unreachable"
      }
    },
    notice: (reason, socket) => notice(reason, socket),
  }
}
