/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema codegraph", () => {
  describe("#given the codegraph section is present without overrides", () => {
    test("#when parsed #then codegraph is enabled by default", () => {
      // given
      const input = {
        codegraph: {},
      }

      // when
      const result = OhMyOpenCodeConfigSchema.parse(input)

      // then
      expect(result.codegraph).toEqual({
        auto_init: true,
        auto_provision: true,
        daemon: false,
        enabled: true,
      })
    })
  })

  describe("#given codegraph is explicitly opted out", () => {
    test("#when parsed #then enabled remains false and other defaults are applied", () => {
      // given
      const input = {
        codegraph: {
          enabled: false,
        },
      }

      // when
      const result = OhMyOpenCodeConfigSchema.parse(input)

      // then
      expect(result.codegraph).toEqual({
        auto_init: true,
        auto_provision: true,
        daemon: false,
        enabled: false,
      })
    })
  })

  describe("#given all shared codegraph keys are configured", () => {
    test("#when parsed #then the shared shape is preserved", () => {
      // given
      const input = {
        codegraph: {
          auto_provision: false,
          enabled: true,
          install_dir: "~/.omo/codegraph",
          telemetry: false,
          watch_debounce_ms: 250,
        },
      }

      // when
      const result = OhMyOpenCodeConfigSchema.parse(input)

      // then
      expect(result.codegraph).toEqual({
        ...input.codegraph,
        auto_init: true,
        daemon: false,
      })
    })
  })

  describe("#given malformed codegraph values", () => {
    test("#when parsed #then bad types are rejected", () => {
      // given
      const input = {
        codegraph: {
          enabled: "yes",
        },
      }

      // when
      const result = OhMyOpenCodeConfigSchema.safeParse(input)

      // then
      expect(result.success).toBe(false)
    })
  })
})
