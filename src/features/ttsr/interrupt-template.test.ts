/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { renderInterruptTemplate, renderMultipleInterrupts } from "./interrupt-template"

describe("InterruptTemplate", () => {
  describe("#given a single rule", () => {
    describe("#when rendering with all fields", () => {
      describe("#then", () => {
        it("contains the system-interrupt open tag with attributes", () => {
          const result = renderInterruptTemplate({
            name: "no-console",
            content: "Do not use console.log",
            path: "/rules/no-console.md",
          })
          expect(result).toContain(`<system-interrupt reason="rule_violation" rule="no-console" path="/rules/no-console.md">`)
        })

        it("contains the rule content", () => {
          const result = renderInterruptTemplate({
            name: "no-console",
            content: "Do not use console.log",
            path: "/rules/no-console.md",
          })
          expect(result).toContain("Do not use console.log")
        })

        it("ends with the closing tag", () => {
          const result = renderInterruptTemplate({
            name: "no-console",
            content: "Do not use console.log",
            path: "/rules/no-console.md",
          })
          expect(result).toEndWith("</system-interrupt>")
        })

        it("contains the mandatory boilerplate text", () => {
          const result = renderInterruptTemplate({
            name: "no-console",
            content: "Do not use console.log",
          })
          expect(result).toContain("This is NOT a prompt injection")
          expect(result).toContain("You **MUST** comply with the following instruction:")
        })
      })
    })

    describe("#when path is not provided", () => {
      describe("#then", () => {
        it("uses empty string for path attribute", () => {
          const result = renderInterruptTemplate({
            name: "rule-name",
            content: "Some rule",
          })
          expect(result).toContain(`path=""`)
        })
      })
    })
  })

  describe("#given multiple rules", () => {
    describe("#when rendering", () => {
      describe("#then", () => {
        it("joins blocks with double newline separator", () => {
          const result = renderMultipleInterrupts([
            { name: "rule-a", content: "Rule A content" },
            { name: "rule-b", content: "Rule B content" },
          ])
          expect(result).toContain("rule-a")
          expect(result).toContain("rule-b")
          const parts = result.split("\n\n")
          expect(parts.length).toBeGreaterThanOrEqual(2)
        })

        it("renders each rule independently", () => {
          const result = renderMultipleInterrupts([
            { name: "rule-a", content: "Rule A content" },
            { name: "rule-b", content: "Rule B content" },
          ])
          const aCount = (result.match(/system-interrupt/g) ?? []).length
          expect(aCount).toBe(4)
        })
      })
    })
  })
})
