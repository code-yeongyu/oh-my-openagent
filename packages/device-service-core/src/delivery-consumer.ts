import { type ConnectOptions, connectLocalApi, type LocalApiClient } from "./local-api/client.ts"
import type {
  CommandRpc,
  DeliveryHolds,
  DeliveryInbound,
  DrainedData,
  JsonObject,
  PendingPair,
} from "./local-api/protocol.ts"
import { connectLocalBackground } from "./background-transport.ts"
import { connectDeviceService, deviceServiceStateDir } from "./device-service.ts"
import type { CommandResult } from "./remote-attach.ts"

/**
 * omo#13037: an engine process's delivery-consumer connection to this device's service, on the local API v1 the
 * vendored client speaks (deliveries.serve and its answers, protocol-deliveries.ts). One connection per consumer: the
 * declaration ends with it. A refusal rejects with the service's LocalApiError, whose `code` names it.
 */
export type DeliveryConsumerClient = {
  /** The service's own version, from its welcome. */
  readonly serviceVersion: string
  readonly serve: (request: { readonly agent_dir: string; readonly v: number }) => Promise<{ readonly wake: boolean }>
  readonly answer: (
    delivery: { readonly sender_device: string; readonly command_id: string },
    reply: JsonObject,
  ) => Promise<void>
  readonly held: (askId: string, holds: boolean) => Promise<void>
  readonly peerAdmitted: (device: string) => Promise<boolean>
  /**
   * One record to a session on another device (omo#14560's delivery-outcome notice), on its own background connection
   * opened for this call and closed after it, so the consumer's declaration connection never carries a command.
   */
  readonly wakeCommand: (
    device: string,
    durableId: string,
    rpc: CommandRpc,
    options?: { readonly waitMs?: number },
  ) => Promise<CommandResult>
  readonly pending: (pairs: readonly PendingPair[]) => Promise<void>
  readonly drained: (pair: PendingPair) => Promise<DrainedData>
  readonly onInbound: (listener: (event: DeliveryInbound) => void) => () => void
  readonly onHolds: (listener: (event: DeliveryHolds) => void) => () => void
  readonly onWake: (listener: (enabled: boolean) => void) => () => void
  readonly close: () => void
  readonly closed: Promise<void>
}

export type ConnectDeliveryConsumerOptions = {
  /** The version of this omo build, reported to the service in its hello. */
  readonly version: string
  readonly stateDir?: string
  /** Test seam: the local API connection (the vendored v1 client by default). */
  readonly connect?: (options: ConnectOptions) => Promise<LocalApiClient>
}

/** Opens the consumer's own proven connection; it never keeps the engine process alive. */
export async function connectDeliveryConsumer(
  options: ConnectDeliveryConsumerOptions,
): Promise<DeliveryConsumerClient> {
  const stateDir = options.stateDir ?? deviceServiceStateDir()
  const client = await (options.connect ?? connectLocalApi)({
    stateDir,
    client: { name: "omo", version: options.version },
    transport: () => connectLocalBackground(stateDir),
  })
  return {
    serviceVersion: client.welcome.service_version,
    serve: (request) => client.request("deliveries.serve", request),
    answer: async (delivery, reply) => {
      await client.request("delivery.answer", { ...delivery, reply })
    },
    held: async (askId, holds) => {
      await client.request("delivery.held", { ask_id: askId, holds })
    },
    peerAdmitted: async (device) => (await client.request("peer.admitted", { device })).admitted,
    wakeCommand: async (device, durableId, rpc, commandOptions) => {
      const sender = await connectDeviceService({ version: options.version, stateDir, background: true })
      try {
        return await sender.wakeCommand(device, durableId, rpc, commandOptions)
      } finally {
        sender.close()
      }
    },
    pending: async (pairs) => {
      await client.request("delivery.pending", { pairs })
    },
    drained: (pair) => client.request("delivery.drained", pair),
    onInbound: (listener) =>
      client.onEvent((event) => {
        if (event.kind === "delivery.inbound") listener(event)
      }),
    onHolds: (listener) =>
      client.onEvent((event) => {
        if (event.kind === "delivery.holds") listener(event)
      }),
    onWake: (listener) =>
      client.onEvent((event) => {
        if (event.kind === "delivery.wake") listener(event.enabled)
      }),
    close: () => client.close(),
    closed: client.closed,
  }
}
