import { describe, expect, test } from "bun:test"

import { MetaGovernorConfigSchema } from "./meta-governor"

describe("MetaGovernorConfigSchema", () => {
  describe("#given all fields are omitted", () => {
    test("#when parsed #then it returns defaults", () => {
      // given
      const input = {}

      // when
      const result = MetaGovernorConfigSchema.parse(input)

      // then
      expect(result).toEqual({
        enabled: false,
        hook_enabled: true,
        observed_tools: ["edit", "bash", "task"],
      })
    })
  })

  describe("#given explicit values", () => {
    test("#when parsed #then it preserves them", () => {
      // given
      const input = {
        enabled: true,
        hook_enabled: false,
        observed_tools: ["read"],
      }

      // when
      const result = MetaGovernorConfigSchema.parse(input)

      // then
      expect(result).toEqual({
        enabled: true,
        hook_enabled: false,
        observed_tools: ["read"],
      })
    })
  })
})
