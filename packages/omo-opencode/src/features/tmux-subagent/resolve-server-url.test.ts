import { describe, expect, test } from "bun:test"

import { resolveServerUrl } from "./resolve-server-url"

describe("resolveServerUrl", () => {
  describe("#given a valid override URL", () => {
    test("#when resolved #then it returns the override", () => {
      const logs: Array<{ message: string; data?: unknown }> = []

      const result = resolveServerUrl(
        "http://localhost:4096",
        {},
        (message, data) => {
          logs.push({ message, data })
        },
      )

      expect(result).toBe("http://localhost:4096")
      expect(logs).toEqual([])
    })
  })

  describe("#given a URL with port 0", () => {
    test("#when resolved #then it falls back to localhost", () => {
      const result = resolveServerUrl("http://100.77.163.81:0", {}, () => {})

      expect(result).toBe("http://localhost:4096")
    })
  })

  describe("#given no URL", () => {
    test("#when OPENCODE_PORT is set #then it uses that port in the fallback", () => {
      const result = resolveServerUrl(undefined, { OPENCODE_PORT: "5555" }, () => {})

      expect(result).toBe("http://localhost:5555")
    })
  })
})
