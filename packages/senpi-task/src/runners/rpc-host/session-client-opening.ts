import type { RpcTransportGoneError } from "@code-yeongyu/senpi"
import { log } from "@oh-my-opencode/utils"
import { loadSenpiBarrel } from "../../lazy/senpi-barrel"
import { engineAcceptsSpawnedBy } from "../engine-spawned-by"
import { HostUnavailableError } from "./daemon"
import {
  assertHostUsable, RETRY_FALLBACK_PROFILE_CAPABILITY, toWireOpen,
  type HostProtocolProbe, type HostRpcClient, type HostRpcClientFactory, type HostSessionOpenInput,
} from "./session-transport"
import { toOpenFailure } from "./session-wire"

interface SessionOpeningPorts {
  readonly socketPath: string
  readonly createClient: HostRpcClientFactory
  readonly probeProtocolInfo: HostProtocolProbe
  readonly socketAccepts: (socketPath: string) => Promise<boolean>
  readonly onDisconnect: (error: RpcTransportGoneError) => void
  readonly onEvent: (record: unknown) => void
  readonly bindClient: (client: HostRpcClient | undefined) => void
}

/** Probe and open one child connection; preserve the host's refusal and profile contracts. */
export async function openHostSessionConnection(input: HostSessionOpenInput, ports: SessionOpeningPorts) {
  const probed = await ports.probeProtocolInfo(ports.socketPath)
  if (probed === undefined && (await ports.socketAccepts(ports.socketPath))) {
    throw new HostUnavailableError("host_busy", {
      fallbackAllowed: false,
      detail: "the daemon accepts connections but did not answer get_protocol_info",
    })
  }
  const identity = assertHostUsable(probed)
  const client = await ports.createClient({ socketPath: ports.socketPath, onDisconnect: ports.onDisconnect })
  client.onEvent(ports.onEvent)
  await client.start()
  ports.bindClient(client)
  const profileHonored = identity.capabilities.includes(RETRY_FALLBACK_PROFILE_CAPABILITY)
  const retryFallbackDropped = !profileHonored && input.retryFallback !== undefined
  // No capability names spawnedBy, so the host's engine version decides; an unproven host opens without it.
  const spawnedByHonored = engineAcceptsSpawnedBy(identity.engineVersion)
  if (!spawnedByHonored && input.spawnedBy !== undefined) {
    log("senpi-task host engine does not accept spawnedBy; opening the child without ancestry", {
      socket: ports.socketPath,
      engineVersion: identity.engineVersion,
    })
  }
  const supported = profileHonored ? input : withoutRetryFallback(input)
  const wire = toWireOpen(spawnedByHonored ? supported : withoutSpawnedBy(supported))
  const opened = await client.openSession(wire).catch(async (error: unknown) => {
    ports.bindClient(undefined)
    await client.stop()
    const { isTransportGoneError } = await loadSenpiBarrel()
    if (isTransportGoneError(error)) {
      throw new HostUnavailableError("host_unreachable", {
        fallbackAllowed: false,
        detail: `the host went away during open_session: ${error instanceof Error ? error.message : String(error)}`,
      })
    }
    throw toOpenFailure(error, input.sessionPath)
  })
  return { opened, identity, retryFallbackDropped }
}

function withoutRetryFallback(input: HostSessionOpenInput): HostSessionOpenInput {
  const { retryFallback: _retryFallback, ...rest } = input
  return rest
}

function withoutSpawnedBy(input: HostSessionOpenInput): HostSessionOpenInput {
  const { spawnedBy: _spawnedBy, ...rest } = input
  return rest
}
