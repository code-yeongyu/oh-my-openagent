/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { DisplayConfigSchema } from "./display"

describe("DisplayConfigSchema", () => {
  describe("#given all fields are omitted", () => {
    test("#when parsed #then it returns the default display config", () => {
      const result = DisplayConfigSchema.parse({})

      expect(result).toEqual({
        show_models_on_session_start: false,
        show_models_on_fallback: false,
        auto_pick: false,
        auto_pick_budget: 2,
      })
    })
  })

  describe("#given a partial override", () => {
    test("#when parsed #then it merges with defaults", () => {
      const result = DisplayConfigSchema.parse({
        show_models_on_session_start: true,
        auto_pick_budget: 5,
      })

      expect(result.show_models_on_session_start).toBe(true)
      expect(result.show_models_on_fallback).toBe(false)
      expect(result.auto_pick).toBe(false)
      expect(result.auto_pick_budget).toBe(5)
    })
  })

  describe("#given a negative budget", () => {
    test("#when parsed #then it rejects", () => {
      expect(() => DisplayConfigSchema.parse({ auto_pick_budget: -1 })).toThrow()
    })
  })

  describe("#given a non-integer budget", () => {
    test("#when parsed #then it rejects", () => {
      expect(() => DisplayConfigSchema.parse({ auto_pick_budget: 1.5 })).toThrow()
    })
  })
})
