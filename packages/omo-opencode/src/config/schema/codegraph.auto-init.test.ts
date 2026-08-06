/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { CodegraphConfigSchema } from "./codegraph"

describe("CodegraphConfigSchema", () => {
  describe("#given auto_init is not specified", () => {
    test("#when parsed #then auto_init defaults to true", () => {
      // given
      const input = {}

      // when
      const result = CodegraphConfigSchema.parse(input)

      // then
      expect(result.auto_init).toBe(true)
    })
  })

  describe("#given auto_init is explicitly false", () => {
    test("#when parsed #then auto_init is false", () => {
      // given
      const input = { auto_init: false }

      // when
      const result = CodegraphConfigSchema.parse(input)

      // then
      expect(result.auto_init).toBe(false)
    })
  })

  describe("#given auto_init is explicitly true", () => {
    test("#when parsed #then auto_init is true", () => {
      // given
      const input = { auto_init: true }

      // when
      const result = CodegraphConfigSchema.parse(input)

      // then
      expect(result.auto_init).toBe(true)
    })
  })
})
