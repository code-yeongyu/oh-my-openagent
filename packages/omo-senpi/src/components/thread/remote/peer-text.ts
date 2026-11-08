import { renderDeliveryText } from "../gateway/provenance"
import type { EffectiveLane, Provenance } from "../gateway/types"
import type { RemoteSendRequest } from "./remote-ops"

/**
 * The sending session as a local gateway delivery names it (gateway/engine.ts senderFacts), and the chain it continues. Every
 * field comes from the sender's own runtime, never from the message (#12852).
 */
export type RemotePeer = {
  readonly session_id: string
  readonly name?: string
  readonly provenance: Provenance
  readonly delivery_id: string
  readonly root_id: string
  readonly hop: number
}

/**
 * Who a prompt to another device speaks for: a person at this device's command line (`omo remote send`), whose text is their
 * own input there, or a peer session (the thread tools), whose text carries its provenance and expands nothing.
 */
export type RemoteSender = { readonly kind: "person"; readonly hop: number } | ({ readonly kind: "peer" } & RemotePeer)

/**
 * The text another device's session receives: the provenance header, authority sentence and JSON body a local delivery's
 * receiver renders (gateway/provenance.ts), plus the device it left from. The receiving engine still writes it as a user
 * prompt; admitting it as a peer delivery needs a senpi record that admits external messages over RPC (senpi#6233).
 */
export function peerText(peer: RemotePeer, device: string | null, request: RemoteSendRequest, effective: EffectiveLane): string {
  return renderDeliveryText({
    delivery_id: peer.delivery_id,
    envelope: {
      provenance: device === null ? peer.provenance : { ...peer.provenance, device },
      origin: { session: peer.session_id },
      actor: peer.name ?? peer.session_id,
      via: [peer.session_id],
      root_id: peer.root_id,
      hop: peer.hop,
      delivery_id: peer.delivery_id,
    },
    body: request.message,
    mode_requested: request.delivery ?? "auto",
    mode_effective: effective,
    binding_id: null,
    binding_revision: null,
  })
}
