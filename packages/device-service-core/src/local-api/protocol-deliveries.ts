// Vendored from sisyphuslabs/omo-relay-daemon@08905c110bb10ab2ba725ff8b8c642a64fbd1652 packages/local-api/src/protocol-deliveries.ts
import type { Empty, EventOf, JsonObject } from "./protocol.ts";

// omo#13037 on the local API v1: delivery consumers. An omo engine process that holds the long-lived connection
// declares, with deliveries.serve, that it takes peer deliveries for one registered agent directory; the declaration is
// its own request kind (an older service answers unknown_type and the agent directory registration is untouched), is
// held in memory and ends with the connection. The service then hands such a consumer a delivery for a session no engine
// lists as delivery.inbound, and the consumer answers it with delivery.answer, whose reply becomes the command's reply.
// With consumers on more than one agent directory the service first asks each with delivery.holds, answered by
// delivery.held. peer.admitted is a consumer's question: is this device admitted with the grant now.
export const DELIVERIES_PROTOCOL = 1;
export type DeliveriesServe = {
  readonly id: string;
  readonly type: "deliveries.serve";
  readonly agent_dir: string;
  readonly v: number;
};
export type DeliveryAnswer = {
  readonly id: string;
  readonly type: "delivery.answer";
  /** A5.1: the pair the service's ledger keys the command by; a command id alone may be another sender's too. */
  readonly sender_device: string;
  readonly command_id: string;
  readonly reply: JsonObject;
};
export type DeliveryHeld = {
  readonly id: string;
  readonly type: "delivery.held";
  readonly ask_id: string;
  readonly holds: boolean;
};
// omo#13037 A2.5: a (sender device, session) pair whose intake rows are not all applied yet, with the newest command the
// consumer answered queued for it. delivery.pending is the consumer's FULL list (it replaces that consumer's marks);
// delivery.drained reports one pair applied, read in the same store transaction that found it empty.
export type PendingPair = {
  readonly sender_device: string;
  readonly session_id: string;
  readonly last_command_id: string;
};
export type DeliveryPending = {
  readonly id: string;
  readonly type: "delivery.pending";
  readonly pairs: readonly PendingPair[];
};
export type DeliveryDrained = {
  readonly id: string;
  readonly type: "delivery.drained";
} & PendingPair;
export type DrainedData =
  | { readonly kept: false }
  | { readonly kept: true; readonly expecting: string };
export type PeerAdmitted = {
  readonly id: string;
  readonly type: "peer.admitted";
  readonly device: string;
};
export type DeliveriesRequest =
  | DeliveriesServe
  | DeliveryAnswer
  | DeliveryHeld
  | DeliveryPending
  | DeliveryDrained
  | PeerAdmitted;
export type DeliveriesResponseData = {
  /** omo#13037 A7.2.3: the wake switch's effective value at the acknowledgement. */
  readonly "deliveries.serve": { readonly wake: boolean };
  readonly "delivery.answer": Empty;
  readonly "delivery.held": Empty;
  readonly "delivery.pending": Empty;
  /** A5.3: kept names the command the service still expects for the pair; a consumer with no open row for it reports
   * drained again with that id. */
  readonly "delivery.drained": DrainedData;
  readonly "peer.admitted": { readonly admitted: boolean };
};
export type DeliveryInbound = EventOf<
  "delivery.inbound",
  {
    readonly command_id: string;
    readonly sender_device: string;
    readonly durable_id: string;
    readonly record: JsonObject;
  }
>;
export type DeliveryHolds = EventOf<
  "delivery.holds",
  { readonly ask_id: string; readonly durable_id: string }
>;
/** omo#13037 A7.2.3: every committed change of the wake switch, to a connection with an acknowledged serve only. */
export type DeliveryWake = EventOf<"delivery.wake", { readonly enabled: boolean }>;
export type DeliveryEvent = DeliveryInbound | DeliveryHolds | DeliveryWake;
