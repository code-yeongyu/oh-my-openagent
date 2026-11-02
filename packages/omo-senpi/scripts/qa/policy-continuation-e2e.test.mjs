import { describe, expect, test } from "bun:test"

import { auditContinuationTrace, contextWindowFor, continuationCustomType, FAILURES, LANES, providerOutcome, selfTest } from "./policy-continuation-e2e.mjs"

// The deterministic half of the live driver, so `bun test packages/omo-senpi` (the senpi QA lane and
// its CI step) keeps the scenario definitions honest without spawning a Senpi child.
describe("policy continuation live driver", () => {
  test("#given the driver module #when it is imported #then the self-test passes against the pinned host", async () => {
    await expect(selfTest()).resolves.toEqual({ ok: true, lanes: LANES, failures: FAILURES })
  })

  test("#given the scenario matrix #when it is read #then it covers both lanes and both host-owned edges", () => {
    expect(LANES).toEqual(["loop", "boulder"])
    expect(FAILURES).toEqual(["policy", "refusal", "retry", "compaction"])
    expect(continuationCustomType("loop")).toBe("omo-senpi:ulw-continuation")
    expect(continuationCustomType("boulder")).toBe("omo-senpi:ulw-execute-continuation")
    expect(providerOutcome("failure", "retry", 1).errorMessage).toContain("503")
    expect(providerOutcome("failure", "retry", 2).stopReason).toBe("stop")
    expect(providerOutcome("failure", "compaction", 1).usage.input).toBeGreaterThan(
      contextWindowFor("compaction") * 0.9,
    )
    expect(contextWindowFor("compaction")).toBeLessThan(contextWindowFor("policy"))
  })

  test("#given a send that rides an unsettled agent_end #when the trace is audited #then it is reported", () => {
    const audit = auditContinuationTrace([
      { type: "edge_agent_end", willRetry: true },
      { type: "omo_send", message: { customType: "omo-senpi:wake" } },
      { type: "edge_agent_end", willRetry: false },
      { type: "edge_agent_settled" },
      { type: "omo_send", message: { customType: "omo-senpi:wake" } },
    ])
    expect(audit).toMatchObject({ ends: 2, settles: 1, hostOwnedEnds: 1, sendsOnHostOwnedEdge: 1, retryOwnedEnds: 1 })
    expect(audit.sends).toHaveLength(2)
  })
})
