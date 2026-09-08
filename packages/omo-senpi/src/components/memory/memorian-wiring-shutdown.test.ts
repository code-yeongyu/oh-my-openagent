import { describe, expect, test } from "bun:test"

import { SESSION_ID, context, gate } from "./memorian-wiring.test-support"

describe("createMemorianGateWiring lifecycle", () => {
  test("#given an active session #when shutdown runs #then the runner cancels, drains, and clears its compaction epoch", async () => {
    const identity = await context()
    const calls: string[] = []
    const wiring = gate({
      launches: [],
      identity,
      cancel: async () => { calls.push("cancel") },
      whenIdle: async () => { calls.push("idle") },
    })
    wiring.onCompactionAccepted(SESSION_ID)
    await wiring.onSessionShutdown(SESSION_ID)
    expect(calls).toEqual(["cancel", "idle"])
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(0)
  })

  test("#given accepted compactions #when the epoch is read #then it reflects every bump for that session alone", async () => {
    const identity = await context()
    const wiring = gate({ launches: [], identity })
    wiring.onCompactionAccepted(SESSION_ID)
    wiring.onCompactionAccepted(SESSION_ID)
    expect(wiring.currentCompactionEpoch(SESSION_ID)).toBe(2)
    expect(wiring.currentCompactionEpoch("other-session")).toBe(0)
  })
})
