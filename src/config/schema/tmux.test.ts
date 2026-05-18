/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { TmuxConfigSchema, TmuxIsolationSchema } from "./tmux"

describe("TmuxIsolationSchema", () => {
  describe('#given all supported isolation values', () => {
    test('#when parsed #then it accepts inline, window, and session', () => {
      expect(TmuxIsolationSchema.parse("inline")).toBe("inline")
      expect(TmuxIsolationSchema.parse("window")).toBe("window")
      expect(TmuxIsolationSchema.parse("session")).toBe("session")
    })
  })
})

describe("TmuxConfigSchema", () => {
  describe('#given tmux isolation is omitted', () => {
    test('#when parsed #then default isolation is inline', () => {
      const result = TmuxConfigSchema.parse({})

      expect(result.isolation).toBe("inline")
    })
  })
})
