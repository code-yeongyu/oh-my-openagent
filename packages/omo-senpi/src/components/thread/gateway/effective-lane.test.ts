import { afterEach, expect, test } from "bun:test"

import type { GatewayDeliveryMode } from "./types"
import { createGatewayHarness, type GatewayHarness } from "./testing/harness"

/**
 * #14333 (LEAD ruling): a same-device delivery's result and the header its receiver reads name the lane the message
 * actually took. An idle session is started through the engine's followUp lane, and that start is `start`, never
 * `follow_up`: a header reading `effective=follow_up` on an immediate start is what made a person think messages queue.
 * The relay leg's twin is `default-delivery.test.ts`.
 */
let harness: GatewayHarness | undefined
afterEach(async () => {
  await harness?.dispose()
  harness = undefined
})

test.each([
  ["idle", "auto", "started", "start"],
  ["idle", "follow_up", "started", "start"],
  ["mid_turn", "auto", "steered", "steer"],
  ["mid_turn", "follow_up", "queued", "follow_up"],
] as const)(
  "#given a %s receiver #when A sends with mode %s #then it is %s, and the result and the header both say %s",
  async (state, mode: GatewayDeliveryMode, outcome, lane) => {
    const h = (harness = createGatewayHarness())
    h.session("A")
    const b = h.session("B")
    if (state === "mid_turn") b.runtime.beginUserTurn()
    const result = await h.get("A").engine.deliver({
      sender: { kind: "session", durable_id: "A" },
      target: "B",
      text: `${state}/${mode}`,
      mode,
    })
    await h.quiesce()
    if (result.kind !== "ok") throw new Error(`expected ok, got ${JSON.stringify(result)}`)
    expect({ delivery: result.delivery.kind, effective_mode: result.effective_mode }).toEqual({
      delivery: outcome,
      effective_mode: lane,
    })
    expect((await b.store.deliveryView(result.delivery_id))?.row.mode_effective).toBe(lane)
    expect((b.runtime.textOf(result.delivery_id) ?? "").split("\n")[0]).toContain(
      ` requested=${mode} effective=${lane} `,
    )
  },
)
