import { describe, expect, test } from "bun:test"
import { estimateEntryTokens, planRescueCompaction } from "./rescue"

function messageEntry(id: string, role: string, text: string): Record<string, unknown> {
  return { id, type: "message", message: { role, content: [{ type: "text", text }] } }
}

describe("estimateEntryTokens", () => {
  test("#given a serializable entry #when estimating #then the estimate is the serialized byte length inflated to tokens", () => {
    // given
    const entry = messageEntry("e1", "user", "abcdefgh") // 8 visible chars

    // when
    const estimate = estimateEntryTokens(entry)

    // then
    expect(estimate).toBeGreaterThan(0)
  })

  test("#given a cyclic unserializable entry #when estimating #then the estimate fails closed to infinity", () => {
    // given
    const entry: Record<string, unknown> = { id: "e1" }
    entry["self"] = entry

    // when / then
    expect(estimateEntryTokens(entry)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe("planRescueCompaction", () => {
  const usage = { tokens: 236744, contextWindow: 272000 }

  test("#given a branch whose full suffix exceeds the budget but a user-turn boundary fits #when planning #then the earliest safe fitting boundary wins so retention stays maximal", () => {
    // given
    const big = "x".repeat(2400) // ~2400+ tokens: one token per serialized byte
    const entries = [
      messageEntry("e0", "user", big),
      messageEntry("e1", "assistant", big),
      messageEntry("e2", "user", "fresh turn"),
      messageEntry("e3", "assistant", "fresh answer"),
    ]
    // Budget fits e1..e3 (~2600 + summary reserve) but not e0..e3 (~5100).
    const reserveTokens = 272000 - 4000

    // when
    const plan = planRescueCompaction({ entries, usage, reserveTokens })

    // then
    expect(plan?.firstKeptEntryId).toBe("e1")
  })

  test("#given the earliest fitting boundary is a tool result #when planning #then the plan skips it to avoid a dangling tool pair", () => {
    // given
    const entries = [
      messageEntry("e0", "user", "y".repeat(1600)),
      { id: "e1", type: "message", message: { role: "toolResult", content: [] } },
      messageEntry("e2", "assistant", "recovered answer"),
    ]
    // Only e2..end fits.
    const reserveTokens = 272000 - 700

    // when
    const plan = planRescueCompaction({ entries, usage, reserveTokens })

    // then
    expect(plan?.firstKeptEntryId).toBe("e2")
  })

  test("#given even the last entry alone exceeds the budget #when planning #then no plan is produced", () => {
    // given
    const monster = "z".repeat(9_600_000)
    const entries = [messageEntry("e0", "user", monster)]

    // when
    const plan = planRescueCompaction({ entries, usage, reserveTokens: 16384 })

    // then
    expect(plan).toBeUndefined()
  })

  test("#given a fitting plan #when inspecting the result #then the summary carries the checkpoint marker and details identify the rescue origin", () => {
    // given
    const entries = [messageEntry("e0", "user", "keep me"), messageEntry("e1", "assistant", "ok")]

    // when
    const plan = planRescueCompaction({ entries, usage, reserveTokens: 16384 })

    // then
    expect(plan?.summary).toContain("[Deterministic compaction recovery checkpoint]")
    expect(plan?.summary).toContain("did not complete")
    expect(plan?.details["schema"]).toBe("omo.compaction-recovery.v1")
    expect(plan?.details["origin"]).toBe("required-compaction-recovery-rescue")
    expect(plan?.tokensBefore).toBe(236744)
  })

  test("#given unknown current token count #when planning #then tokensBefore falls back to zero", () => {
    // given
    const entries = [messageEntry("e0", "user", "hello")]

    // when
    const plan = planRescueCompaction({ entries, usage: { tokens: null, contextWindow: 272000 }, reserveTokens: 16384 })

    // then
    expect(plan?.tokensBefore).toBe(0)
  })
})
