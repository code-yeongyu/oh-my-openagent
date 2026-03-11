import { describe, it, expect, beforeEach } from "bun:test"
import { compressToolOutput } from "./compressors/tool-output"

describe("tool-output compressor", () => {
  beforeEach(() => {})

  describe("#given a hot-tier tool message", () => {
    describe("#when compressToolOutput is called", () => {
      it("#then it should return null and skip compression", () => {
        const result = compressToolOutput("line1\nline2", "bash", "hot", null)

        expect(result).toBeNull()
      })
    })
  })

  describe("#given warm-tier output with key lines", () => {
    describe("#when compressToolOutput is called", () => {
      it("#then it should extract key lines and append remaining-line suffix", () => {
        const output = [
          "start",
          "ERROR failed to execute",
          "/workspace/oh-my-opencode/src/hooks/context-gc/file.ts",
          "function runTask() {}",
          "normal status",
          "done",
        ].join("\n")

        const result = compressToolOutput(output, "bash", "warm", null)

        expect(result).not.toBeNull()
        expect(result?.compressed).toContain("ERROR failed to execute")
        expect(result?.compressed).toContain("/workspace/oh-my-opencode/src/hooks/context-gc/file.ts")
        expect(result?.compressed).toContain("function runTask() {}")
        expect(result?.compressed).toContain("... [3 more lines]")
      })

      it("#then it should include brain reference in the warm suffix when available", () => {
        const output = [
          "INFO",
          "FAIL test case",
          "plain",
        ].join("\n")

        const result = compressToolOutput(output, "grep", "warm", 19)

        expect(result?.compressed).toContain("... [2 more lines [brain#19: grep]]")
      })
    })
  })

  describe("#given warm-tier output without key lines", () => {
    describe("#when compressToolOutput is called", () => {
      it("#then it should fallback to first 3 non-empty lines", () => {
        const output = ["alpha", "beta", "gamma", "delta"].join("\n")

        const result = compressToolOutput(output, "bash", "warm", null)

        expect(result?.compressed).toContain("alpha")
        expect(result?.compressed).toContain("beta")
        expect(result?.compressed).toContain("gamma")
        expect(result?.compressed).toContain("... [1 more lines]")
      })
    })
  })

  describe("#given cold-tier output", () => {
    describe("#when brain reference is available", () => {
      it("#then it should return one-line brain marker summary", () => {
        const result = compressToolOutput("x".repeat(300), "bash", "cold", 77)

        expect(result?.compressed.startsWith("[brain#77:")).toBe(true)
      })
    })

    describe("#when brain reference is unavailable", () => {
      it("#then it should return compressed summary marker", () => {
        const result = compressToolOutput("x".repeat(300), "bash", "cold", null)

        expect(result?.compressed.startsWith("[compressed:")).toBe(true)
      })
    })
  })
})
