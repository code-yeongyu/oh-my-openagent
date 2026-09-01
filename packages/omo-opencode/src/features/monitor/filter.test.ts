import { describe, expect, test } from "bun:test"

import { createMonitorFilter } from "./filter"

describe("createMonitorFilter", () => {
  describe("#given no pattern", () => {
    test('#when matching arbitrary text #then it uses feed-all mode', () => {
      // given
      const result = createMonitorFilter(undefined, { patternMaxLength: 512 })

      // when
      const anythingMatches = result.filter?.matches("anything")
      const emptyMatches = result.filter?.matches("")

      // then
      expect(result.error).toBeUndefined()
      expect(anythingMatches).toBe(true)
      expect(emptyMatches).toBe(true)
    })
  })

  describe('#given pattern "ERROR|FAIL"', () => {
    test("#when matching lines #then only lines containing those words match", () => {
      // given
      const result = createMonitorFilter("ERROR|FAIL", { patternMaxLength: 512 })

      // when
      const errorMatches = result.filter?.matches("process ERROR reported")
      const failMatches = result.filter?.matches("test FAIL reported")
      const infoMatches = result.filter?.matches("process INFO reported")

      // then
      expect(result.error).toBeUndefined()
      expect(result.pattern).toBe("ERROR|FAIL")
      expect(errorMatches).toBe(true)
      expect(failMatches).toBe(true)
      expect(infoMatches).toBe(false)
    })
  })

  describe("#given ANSI-wrapped text", () => {
    test("#when matching with an ERROR pattern #then it strips ANSI before testing", () => {
      // given
      const result = createMonitorFilter("ERROR", { patternMaxLength: 512 })

      // when
      const matches = result.filter?.matches("\x1b[31mERROR\x1b[0m")

      // then
      expect(matches).toBe(true)
    })
  })

  describe('#given invalid pattern "["', () => {
    test("#when creating the filter #then it rejects before matching", () => {
      // given
      const pattern = "["

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("invalid regex")
    })
  })

  describe("#given an over-length pattern", () => {
    test("#when creating the filter #then it rejects before matching", () => {
      // given
      const pattern = "ERROR"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: pattern.length - 1 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("too long")
    })
  })

  describe("#given a catastrophic-backtracking pattern", () => {
    test('#when creating the filter with "(a+)+$" #then it rejects before matching', () => {
      // given
      const pattern = "(a+)+$"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("unsafe")
    })

    test('#when creating the filter with "(.*a){25}" #then it rejects before matching', () => {
      // given
      const pattern = "(.*a){25}"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("unsafe")
    })

    test('#when an interposed bare group hides the nested quantifier "((a+))+$" #then it still rejects', () => {
      // given
      const pattern = "((a+))+$"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("unsafe")
    })

    test('#when the danger is two groups deep "(((a*)))+" #then it still rejects', () => {
      // given
      const pattern = "(((a*)))+"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.filter).toBeNull()
      expect(result.error).toContain("unsafe")
    })

    test("#when a rejected pattern would otherwise hang #then matching never runs the unsafe regex", () => {
      // given
      const result = createMonitorFilter("(a+)+$", { patternMaxLength: 512 })
      const adversarial = `${"a".repeat(40)}!`

      // when
      const start = performance.now()
      const matched = result.filter?.matches(adversarial) ?? false
      const elapsedMs = performance.now() - start

      // then
      expect(matched).toBe(false)
      expect(elapsedMs).toBeLessThan(50)
    })
  })

  describe("#given a safe quantified pattern", () => {
    test('#when creating the filter with "(ERROR|FAIL)+" #then it is accepted', () => {
      // given
      const pattern = "(ERROR|FAIL)+"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.error).toBeUndefined()
      expect(result.filter?.matches("ERRORFAIL")).toBe(true)
    })

    test('#when creating the filter with "\\\\d+ failed" #then it is accepted', () => {
      // given
      const pattern = "\\d+ failed"

      // when
      const result = createMonitorFilter(pattern, { patternMaxLength: 512 })

      // then
      expect(result.error).toBeUndefined()
      expect(result.filter?.matches("12 failed")).toBe(true)
    })
  })
})
