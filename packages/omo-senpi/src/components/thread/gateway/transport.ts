import type { RemoteSessionRow } from "../remote/ports"
import type { EffectiveLane, GatewayDeliveryDelivery, GatewayDeliveryMode, GatewayDeliveryResult, GatewaySender } from "./types"

/**
 * Where one delivery goes once its address is resolved: a session this device holds (its durable id, with the scope
 * the address resolved under), or a session on another device of the account (its listing row). The transport that
 * takes it is chosen by this kind alone; nothing else in the send path reads the device.
 */
export type DeliveryTarget =
  | { readonly kind: "local"; readonly thread_id: string; readonly all_scope?: boolean }
  | { readonly kind: "remote"; readonly row: RemoteSessionRow }

/** The one shape every send becomes before a transport carries it. */
export type OutboundDelivery = {
  readonly sender: GatewaySender
  /** The calling session's durable id (`UNKNOWN_CALLER` when the host passed no execution context). */
  readonly caller_id: string
  readonly target: DeliveryTarget
  readonly text: string
  readonly mode: GatewayDeliveryMode
  /** As the caller wrote it; each transport validates it the way its receiver does (`^\d+$`). */
  readonly expected_turn_id?: string
  readonly idempotency_key: string
  /** The call's parsed arguments, hashed by a transport that keeps its own receipt. */
  readonly args: unknown
  /** The highest chain hop an input of the caller's run arrived with from another device; both transports continue it (K8). */
  readonly inbound_hop?: number
}

/** A delivery to another device has no gateway row on this device, so it names the device it reached instead of a row sequence. */
export type RelayDeliverySuccess = {
  readonly kind: "ok"
  readonly thread_id: string
  readonly delivery: GatewayDeliveryDelivery
  readonly deduplicated: boolean
  readonly device: string
  readonly delivery_id?: string
  readonly effective_mode?: EffectiveLane
}

export type DeliveryOutcome = GatewayDeliveryResult | RelayDeliverySuccess

/**
 * The port between the one delivery pipeline and the way a delivery reaches its receiver. The local transport is the
 * gateway engine (a durable row, its receipt, the target's inbox marker and a wake; the receiver's own drain admits it);
 * the relay transport reaches a session on another device through the device service. Both answer the same union.
 */
export type DeliveryTransport = {
  readonly deliver: (delivery: OutboundDelivery) => Promise<DeliveryOutcome>
}
