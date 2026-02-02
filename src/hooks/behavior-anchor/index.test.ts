import { describe, it, expect, beforeEach } from "bun:test"
import { createBehaviorAnchorHook } from "./index"

describe("createBehaviorAnchorHook", () => {
  //#given a behavior anchor hook with default config
  describe("with default config", () => {
    let hook: ReturnType<typeof createBehaviorAnchorHook>

    beforeEach(() => {
      hook = createBehaviorAnchorHook()
    })

    //#then it should return an object with tool.execute.after handler
    it("should return an object with tool.execute.after handler", () => {
      expect(hook).toBeDefined()
      expect(hook["tool.execute.after"]).toBeFunction()
    })

    //#when detecting slop in output
    describe("when detecting slop in output", () => {
      //#then it should inject guidelines when slop is detected
      it("should inject guidelines when slop is detected", async () => {
        const input = { tool: "bash", sessionID: "test-session", callID: "call-1" }
        const slopOutput = {
          title: "Command Output",
          output: `// This is a comment
// Another comment
// Yet another comment
// More comments
// Even more comments
const x = 1`,
          metadata: {}
        }

        await hook["tool.execute.after"](input, slopOutput)

        // Should have injected guidelines for excessive comments
        expect(slopOutput.output).toContain("BEHAVIOR ANCHOR")
      })

      //#then it should not modify output when no slop detected
      it("should not modify output when no slop detected", async () => {
        const input = { tool: "bash", sessionID: "test-session", callID: "call-1" }
        const cleanOutput = {
          title: "Command Output",
          output: "const x = 1\nconst y = 2\nconst z = 3",
          metadata: {}
        }
        const originalOutput = cleanOutput.output

        await hook["tool.execute.after"](input, cleanOutput)

        // Output should remain unchanged (no slop detected, round 1 not refresh interval)
        expect(cleanOutput.output).toBe(originalOutput)
      })
    })

    //#when reaching refresh interval
    describe("when reaching refresh interval", () => {
      //#then it should inject guidelines at refresh interval
      it("should inject guidelines at refresh interval", async () => {
        const input = { tool: "bash", sessionID: "test-session", callID: "call-1" }
        const output = {
          title: "Command Output",
          output: "clean output",
          metadata: {}
        }

        // Call 10 times to reach default refresh interval
        for (let i = 0; i < 9; i++) {
          await hook["tool.execute.after"](input, { ...output, output: "clean" })
        }

        // 10th call should trigger refresh
        const tenthOutput = { ...output }
        await hook["tool.execute.after"](input, tenthOutput)

        expect(tenthOutput.output).toContain("BEHAVIOR ANCHOR")
      })
    })
  })

  //#given a behavior anchor hook with custom config
  describe("with custom config", () => {
    //#then it should use custom guidelines
    it("should use custom guidelines", async () => {
      const customGuidelines = "CUSTOM GUIDELINES FOR TESTING"
      const hook = createBehaviorAnchorHook({
        guidelines: customGuidelines,
        refreshInterval: 1, // Every call
      })

      const input = { tool: "bash", sessionID: "test-session", callID: "call-1" }
      const output = {
        title: "Command Output",
        output: "some output",
        metadata: {}
      }

      await hook["tool.execute.after"](input, output)

      expect(output.output).toContain(customGuidelines)
    })

    //#then it should respect custom thresholds
    it("should respect custom comment threshold", async () => {
      const hook = createBehaviorAnchorHook({
        commentThreshold: 0.9, // Very high threshold
      })

      const input = { tool: "bash", sessionID: "test-session", callID: "call-1" }
      // 50% comments - should NOT trigger with 0.9 threshold
      const output = {
        title: "Command Output",
        output: `// comment
const x = 1`,
        metadata: {}
      }
      const originalOutput = output.output

      await hook["tool.execute.after"](input, output)

      // Should not inject guidelines (below threshold, not at refresh interval)
      expect(output.output).toBe(originalOutput)
    })
  })
})
