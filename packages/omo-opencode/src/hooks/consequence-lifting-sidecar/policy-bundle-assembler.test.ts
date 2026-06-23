import { describe, expect, it } from "bun:test"

import { assemblePolicyBundle } from "./policy-bundle-assembler"

describe("assemblePolicyBundle", () => {
  it("groups policies into slots using slot tags and naming hints", () => {
    const bundle = assemblePolicyBundle(
      [
        { primaryDecision: "choose_two_phase_conditional" } as never,
        { primaryDecision: "choose_long_conditioned_hedged" } as never,
        { primaryDecision: "choose_vol_trade" } as never,
      ],
      new Map([
        ["choose_two_phase_conditional", ["slot:timing"]],
        ["choose_long_conditioned_hedged", ["slot:primary_decision"]],
        ["choose_vol_trade", ["slot:hedge"]],
      ]),
    )

    expect(bundle.slots.map((slot) => slot.name).sort()).toEqual(["hedge", "primary_decision", "timing"])
  })
})
