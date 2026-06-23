import { describe, expect, it } from "bun:test"
import { EvalHarness } from "./harness"
import { ACCEPTANCE_FIXTURES } from "./fixtures/acceptance-tests"

describe("Memory Architecture Acceptance Tests", () => {
  describe("#given all acceptance fixtures registered", () => {
    describe("#when runAll is called", () => {
      it("#then all acceptance tests complete without unexpected exceptions", async () => {
        const harness = new EvalHarness()
        for (const fixture of ACCEPTANCE_FIXTURES) harness.register(fixture)

        const result = await harness.runAll()

        expect(result.total).toBe(ACCEPTANCE_FIXTURES.length)
        const errored = result.results.filter((r) => r.error !== undefined)
        expect(errored).toHaveLength(0)
      })
    })
  })

  describe("#given individual acceptance fixtures", () => {
    describe("#when session-resume fixture runs", () => {
      it("#then returns a result without throwing", async () => {
        const harness = new EvalHarness()
        harness.register(ACCEPTANCE_FIXTURES[0]!)
        const suite = await harness.runAll()
        expect(suite.results[0]!.error).toBeUndefined()
      })
    })

    describe("#when provider-isolation fixture runs", () => {
      it("#then reports empty API key as unavailable", async () => {
        const harness = new EvalHarness()
        harness.register(ACCEPTANCE_FIXTURES[1]!)
        const suite = await harness.runAll()
        expect(suite.results[0]!.passed).toBe(true)
      })
    })

    describe("#when obsidian-projection fixture runs", () => {
      it("#then writes a note with the stable memory_id filename", async () => {
        const harness = new EvalHarness()
        harness.register(ACCEPTANCE_FIXTURES[2]!)
        const suite = await harness.runAll()
        expect(suite.results[0]!.passed).toBe(true)
      })
    })
  })
})
