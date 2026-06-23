import { describe, expect, it } from "bun:test"
import { createThemisAgent } from "./agent"

describe("createThemisAgent", () => {
  describe("#given defaults", () => {
    describe("#when createThemisAgent is called with a Claude model", () => {
      it("#then returns a subagent AgentConfig with the requested model", () => {
        const config = createThemisAgent("anthropic/claude-opus-4-6")

        expect(config.mode).toBe("subagent")
        expect(config.model).toBe("anthropic/claude-opus-4-6")
        expect(config.description).toBeTruthy()
        expect(config.description?.length).toBeGreaterThan(0)
      })

      it("#then does not allow reason_argue or reason_solve tools", () => {
        const config = createThemisAgent("anthropic/claude-opus-4-6")
        const permissionKeys = Object.keys(config.permission ?? {})

        expect(permissionKeys).not.toContain("reason_argue")
        expect(permissionKeys).not.toContain("reason_solve")
      })
    })
  })
})
