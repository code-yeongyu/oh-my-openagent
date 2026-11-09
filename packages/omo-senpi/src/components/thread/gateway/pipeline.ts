import type { DeliveryOutcome, DeliveryTransport, OutboundDelivery } from "./transport"

type Disposable = { readonly dispose?: () => void }

export type DeliveryPipelineOptions = {
  readonly local: DeliveryTransport & Disposable
  /** Absent when this device reaches no other device: a remote target is then refused, never sent. */
  readonly relay?: DeliveryTransport & Disposable
}

export type DeliveryPipeline = {
  readonly deliver: (delivery: OutboundDelivery) => Promise<DeliveryOutcome>
  /** Shutdown: each transport drops the background work it owns (the relay's re-sends of held deliveries). */
  readonly dispose: () => void
}

/**
 * The one talking channel: every send (the thread tools, a handoff, the SDK) becomes one `OutboundDelivery` and goes
 * to the transport its resolved target names. Nothing past this point branches on the device again.
 */
export function createDeliveryPipeline(options: DeliveryPipelineOptions): DeliveryPipeline {
  return {
    deliver: async (delivery) => {
      if (delivery.target.kind === "local") return await options.local.deliver(delivery)
      if (options.relay === undefined) return { kind: "error", error: { code: "host_unavailable", message: `Thread ${delivery.target.row.session_id} is on device ${delivery.target.row.device}, which this device cannot reach.`, next_action: "Sign in to the account's device service, then retry." } }
      return await options.relay.deliver(delivery)
    },
    dispose: () => {
      options.local.dispose?.()
      options.relay?.dispose?.()
    },
  }
}
