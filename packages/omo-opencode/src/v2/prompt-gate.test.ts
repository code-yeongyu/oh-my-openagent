import { describe, expect, it } from "bun:test"
import { createV2PromptGate } from "./prompt-gate"

describe("#given V2 prompt gate", () => {
  describe("#when dispatching twice in a row", () => {
    it("#then the second collapses into the first hold", async () => {
      // given
      let calls = 0
      let clock = 1_000
      const gate = createV2PromptGate(
        {
          get: async () => ({ outcome: undefined }),
          prompt: async () => {
            calls += 1
            return { id: "inbox-1" }
          },
        } as never,
        { holdMs: 500, now: () => clock },
      )

      // when
      const first = await gate.dispatch({ sessionID: "ses-1", text: "a" })
      const second = await gate.dispatch({ sessionID: "ses-1", text: "b" })
      clock += 600
      const third = await gate.dispatch({ sessionID: "ses-1", text: "c" })

      // then
      expect(first.status).toBe("dispatched")
      expect(second.status).toBe("skipped")
      expect(third.status).toBe("dispatched")
      expect(calls).toBe(2)
    })
  })

  describe("#when the session already finished", () => {
    it("#then dispatch is skipped and the hold released", async () => {
      // given
      let calls = 0
      let clock = 0
      const gate = createV2PromptGate(
        {
          get: async () => ({ outcome: "succeeded" }),
          prompt: async () => {
            calls += 1
            return { id: "inbox-1" }
          },
        } as never,
        { holdMs: 10_000, now: () => clock },
      )

      // when
      const result = await gate.dispatch({ sessionID: "done", text: "a" })

      // then
      expect(result.status).toBe("skipped")
      expect(calls).toBe(0)
    })
  })

  describe("#when prompt throws", () => {
    it("#then the failure releases the hold", async () => {
      // given
      let calls = 0
      const gate = createV2PromptGate(
        {
          get: async () => ({ outcome: undefined }),
          prompt: async () => {
            calls += 1
            throw new Error("boom")
          },
        } as never,
        { holdMs: 10_000, now: () => 0 },
      )

      // when
      const first = await gate.dispatch({ sessionID: "ses-9", text: "a" })
      const second = await gate.dispatch({ sessionID: "ses-9", text: "b" })

      // then
      expect(first.status).toBe("failed")
      expect(second.status).toBe("failed")
      expect(calls).toBe(2)
    })
  })
})
