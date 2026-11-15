import type { DeliveriesRequest } from "../../../src/local-api/protocol.ts"
import { DELIVERIES_PROTOCOL } from "../../../src/local-api/protocol-deliveries.ts"
import { type Conn, eventOf, ok, type Outcome, type OwnerState, refuse } from "./fake-owner-state.ts"

// omo#13037: the reference owner's delivery consumers, ported from omo-relay-daemon #1076
// (packages/local-api/test/conformance/fake-owner-deliveries.ts at 2728922e4b). A declaration from an omo client for a
// World agent dir and the known protocol version is accepted; right after its response the owner hands the consumer
// the World's records and asks it about the World's durable ids. An answer must name a waiting hand-off or an open
// question of its connection.
const declared = (state: OwnerState, conn: Conn, agentDir: string): void => {
  conn.serving = agentDir
  for (const h of state.world.deliveries?.handed ?? []) {
    conn.handed?.add(JSON.stringify([h.sender_device, h.command_id]))
    conn.send(eventOf("delivery.inbound", { ...h }))
  }
  for (const durable of state.world.deliveries?.asked ?? []) {
    const ask = state.mint()
    conn.asks?.add(ask)
    conn.send(eventOf("delivery.holds", { ask_id: ask, durable_id: durable }))
  }
}

export const deliveryHandler = (state: OwnerState, conn: Conn, request: DeliveriesRequest): Outcome => {
  const world = state.world.deliveries
  if (world === undefined) return refuse("unsupported", "this owner takes no delivery consumers")
  switch (request.type) {
    case "deliveries.serve":
      if (conn.client()?.name !== "omo") return refuse("forbidden", "only omo serves deliveries")
      if (request.v !== DELIVERIES_PROTOCOL) return refuse("unsupported", "this owner serves deliveries protocol 1 only")
      if (!world.agent_dirs.includes(request.agent_dir)) return refuse("forbidden", "that agent dir is not registered")
      // A7.2.3: the acknowledgement carries the wake switch's value (the fake owner has none: off).
      return ok({ wake: false }, () => declared(state, conn, request.agent_dir))
    case "delivery.answer":
      return conn.handed?.delete(JSON.stringify([request.sender_device, request.command_id])) === true
        ? ok()
        : refuse("unknown_delivery", "no hand-off of that sender device and command_id waits here")
    case "delivery.held":
      return conn.asks?.delete(request.ask_id) === true
        ? ok()
        : refuse("invalid_request", "no question with that ask_id is open on this connection")
    case "delivery.pending":
      return conn.serving === undefined ? refuse("forbidden", "only a delivery consumer reports") : ok()
    case "delivery.drained":
      return conn.serving === undefined ? refuse("forbidden", "only a delivery consumer reports") : ok({ kept: false })
    case "peer.admitted":
      return conn.serving === undefined
        ? refuse("forbidden", "only a delivery consumer asks")
        : ok({ admitted: world.admitted?.includes(request.device) === true })
  }
}
