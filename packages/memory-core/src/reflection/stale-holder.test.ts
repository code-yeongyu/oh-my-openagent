import { describe, expect, test } from "bun:test"

import { classifyReflectionLockHolder } from "./stale-holder"
import { REFLECTION_DIR, SCENARIOS, probeFor } from "./stale-holder.scenarios.test-support"

describe("reflection lock holder decision (#10377)", () => {
  // Each fail-closed rule has its own scenario that changes exactly one fact of a provably dead
  // holder, so removing that rule changes this scenario's verdict.
  test.each(SCENARIOS.map((scenario) => [scenario.rule === undefined ? scenario.name : `${scenario.name} [rule:${scenario.rule}]`, scenario] as const))(
    "#given %s #when the holder is classified #then the verdict is exact",
    async (_name, scenario) => {
      expect(await classifyReflectionLockHolder(REFLECTION_DIR, probeFor(scenario.facts))).toEqual(scenario.expected)
    },
  )

  test("#given a start-identity reader that throws #when the launcher is alive #then it stays live instead of failing", async () => {
    const scenario = SCENARIOS.find((entry) => entry.rule === "pid-reused")
    if (scenario === undefined) throw new Error("missing scenario")
    const probe = { ...probeFor(scenario.facts), getProcessStartIdentity: async () => { throw new Error("ps failed") } }
    expect(await classifyReflectionLockHolder(REFLECTION_DIR, probe)).toEqual({ state: "live", runId: "reflection-run-64" })
  })
})
