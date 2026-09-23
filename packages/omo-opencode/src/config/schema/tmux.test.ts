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

  describe('#given server_url_override is a valid URL', () => {
    test('#when parsed #then it keeps the override', () => {
      const result = TmuxConfigSchema.parse({
        server_url_override: "http://localhost:4096",
      })

      expect(result.server_url_override).toBe("http://localhost:4096")
    })
  })

  describe('#given server_url_override is empty or null', () => {
    test('#when parsed #then it treats the value as unset', () => {
      expect(TmuxConfigSchema.parse({ server_url_override: "" }).server_url_override).toBeUndefined()
      expect(TmuxConfigSchema.parse({ server_url_override: null }).server_url_override).toBeUndefined()
    })
  })

  describe('#given server_url_override is not a URL', () => {
    test('#when parsed #then validation fails', () => {
      expect(() => TmuxConfigSchema.parse({ server_url_override: "not-a-url" })).toThrow()
    })
  })
})
