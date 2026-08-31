/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { getUltraworkSource, isNonOmoAgent, isPlannerAgent } from "./source-detector"

describe("Ultrawork agent classification", () => {
  test("#given OpenCode native plan agent #then it is non-OMO and never routed to the OMO planner source", () => {
    // given
    const nativePlanAgent = "plan"

    // when
    const planner = isPlannerAgent(nativePlanAgent)
    const nonOmo = isNonOmoAgent(nativePlanAgent)
    const source = getUltraworkSource(nativePlanAgent, "gpt-5.5")

    // then
    expect(planner).toBe(false)
    expect(nonOmo).toBe(true)
    expect(source).not.toBe("planner")
  })

  test("#given OMO planner agents #then planner classification and routing still hold", () => {
    // given / when / then
    expect(isPlannerAgent("prometheus")).toBe(true)
    expect(isPlannerAgent("deep-planner")).toBe(true)
    expect(isPlannerAgent("Plan Agent")).toBe(true)
    expect(isNonOmoAgent("prometheus")).toBe(false)
    expect(getUltraworkSource("prometheus", "gpt-5.5")).toBe("planner")
  })
})
