import { describe, it, expect, beforeEach, mock, spyOn } from "bun:test"
import type { GcPart } from "./types"
import { estimateMessageTokens, estimateTokens } from "./token-budget"

describe("token-budget", () => {
  beforeEach(() => {
    mock.restore()
  })

  describe("#given plain text", () => {
    describe("#when estimateTokens is called", () => {
      it("#then should return zero for empty string", () => {
        expect(estimateTokens("")).toBe(0)
      })

      it("#then should round up token estimates by 4 chars", () => {
        expect(estimateTokens("a")).toBe(1)
        expect(estimateTokens("abcd")).toBe(1)
        expect(estimateTokens("abcde")).toBe(2)
        expect(estimateTokens("abcdefgh")).toBe(2)
      })
    })
  })

  describe("#given mixed message parts", () => {
    describe("#when estimateMessageTokens is called", () => {
      it("#then should use text field from text parts", () => {
        const parts = [{ type: "text", text: "abcdefgh" }] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(2)
      })

      it("#then should use thinking field when present", () => {
        const parts = [{ type: "thinking", thinking: "abcde" }] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(2)
      })

      it("#then should use tool output from state.output", () => {
        const parts = [{ type: "tool", state: { output: "abcdef" } }] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(2)
      })

      it("#then should fallback to state.input when output is missing", () => {
        const parts = [{ type: "tool", state: { input: "abcdefghi" } }] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(3)
      })

      it("#then should fallback to tool name when no text-like fields exist", () => {
        const parts = [{ type: "tool", tool: "webfetch" }] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(2)
      })

      it("#then should return zero for unknown malformed fields", () => {
        const parts = [
          { type: "tool", text: null, thinking: undefined, state: { output: 12345 } },
          { type: "other", value: "ignored" },
        ] as GcPart[]
        expect(estimateMessageTokens(parts)).toBe(0)
      })

      it("#then should sum estimates across multiple part kinds", () => {
        const parts = [
          { type: "text", text: "abcd" },
          { type: "thinking", thinking: "abcde" },
          { type: "tool", state: { output: "abcdef" } },
          { type: "tool", tool: "ls" },
        ] as GcPart[]

        expect(estimateMessageTokens(parts)).toBe(1 + 2 + 2 + 1)
      })
    })
  })

  describe("#given test-local spies", () => {
    describe("#when spyOn is used in this file", () => {
      it("#then should observe builtins without changing behavior", () => {
        const ceilSpy = spyOn(Math, "ceil")
        expect(estimateTokens("abcde")).toBe(2)
        expect(ceilSpy).toHaveBeenCalledWith(1.25)
        ceilSpy.mockRestore()
      })
    })
  })
})
