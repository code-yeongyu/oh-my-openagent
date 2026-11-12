import { threadToolFailure } from "../errors"
import type { GatewayEngine } from "./engine"
import type { DeliveryTransport } from "./transport"

/** Same-device transport: the gateway engine (row + receipt + inbox marker + wake); the receiver's own drain admits it. */
export function createLocalTransport(engine: GatewayEngine): DeliveryTransport {
  return {
    deliver: async (delivery) => {
      if (delivery.target.kind !== "local")
        throw new Error("the local transport delivers only to sessions this device holds")
      // A person at this terminal talks to a session on this device through its TUI; the gateway admits no person prompt.
      if (delivery.sender.kind === "person")
        return {
          kind: "error",
          error: threadToolFailure(
            "unsupported",
            "A person's own input reaches a session on this device through its TUI, not through the gateway.",
            "Attach to the session, or address a session on another device.",
          ),
        }
      let expected: number | undefined
      if (delivery.expected_turn_id !== undefined) {
        if (!/^\d+$/.test(delivery.expected_turn_id))
          return {
            kind: "error",
            error: {
              code: "turn_conflict",
              message: `Turn ${delivery.expected_turn_id} is not a turn of the target session.`,
              next_action: "Read the target again and steer with the turn_id a started or steered result returned.",
            },
          }
        expected = Number(delivery.expected_turn_id)
      }
      return await engine.deliver({
        sender: delivery.sender,
        target: delivery.target.thread_id,
        text: delivery.text,
        mode: delivery.mode,
        ...(expected === undefined ? {} : { expected_turn_id: expected }),
        all_scope: delivery.target.all_scope,
        idempotency_key: delivery.idempotency_key,
        ...(delivery.inbound_hop === undefined ? {} : { inbound_hop: delivery.inbound_hop }),
      })
    },
  }
}
