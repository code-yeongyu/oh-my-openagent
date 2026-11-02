import { describe, expect, test } from "bun:test"

import { toSessionControlDrainResult } from "./adapter"

describe("drain result handed to senpi", () => {
  test("#given a pass that admitted, held and refused deliveries #when it is mapped to senpi's drain result #then only runtime admission kinds remain and gateway refusals are left out", () => {
    expect(toSessionControlDrainResult({
      admitted: [
        { delivery_id: "a", kind: "started" },
        { delivery_id: "b", kind: "not_steerable" },
        { delivery_id: "c", kind: "held_draft" },
        { delivery_id: "d", kind: "expired" },
        { delivery_id: "e", kind: "turn_conflict" },
      ],
    })).toEqual({
      admitted: [
        { delivery_id: "a", kind: "started" },
        { delivery_id: "c", kind: "held_draft" },
        { delivery_id: "e", kind: "turn_conflict" },
      ],
    })
  })
})
