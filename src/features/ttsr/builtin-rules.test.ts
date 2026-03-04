/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createBuiltinTtsrRules } from "./builtin-rules"

describe("BuiltinTtsrRules", () => {
  describe("#given built-in rules factory", () => {
    describe("#when creating rules", () => {
      describe("#then", () => {
        it("returns the multi_tool_use.parallel guard rule", () => {
          const rules = createBuiltinTtsrRules()
          expect(rules).toHaveLength(1)

          const [rule] = rules
          expect(rule.name).toBe("multi-tool-use-parallel")
          expect(rule.scope).toEqual(["text"])
          expect(rule.content.trim().length).toBeGreaterThan(0)

          const [pattern] = rule.condition
          expect(new RegExp(pattern).test("multi_tool_use.parallel")).toBe(true)
        })
      })
    })
  })
})
