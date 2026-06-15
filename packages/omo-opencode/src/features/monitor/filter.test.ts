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
})
