import { describe, expect, it } from "bun:test"

import { classifyRecourse } from "./recourse-classifier"
import { estimateVOI } from "./voi-estimator"

describe("VOI estimation", () => {
  it("recommends defer for narrow-margin low-certainty irreversible decisions", () => {
    const voi = estimateVOI({ decision: "deploy_prod", framework_certainty: "low", world_certainty: "low" } as never, 0.1, "irreversible")
    expect(voi.deferRecommended).toBe(true)
  })

  it("classifies wait/two-phase policies as reversible", () => {
    expect(classifyRecourse({ decision: "choose_two_phase_conditional" } as never)).toBe("reversible")
    expect(classifyRecourse({ decision: "choose_no_trade_wait" } as never)).toBe("reversible")
  })
})
