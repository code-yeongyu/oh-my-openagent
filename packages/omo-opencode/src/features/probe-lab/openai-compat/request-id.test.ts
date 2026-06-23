import { describe, expect, test } from "bun:test"
import { extractOrGenerateRequestId } from "./request-id"

describe("extractOrGenerateRequestId", () => {
  describe("#given a request with a valid x-request-id header", () => {
    test("#when extracted #then returns the header value verbatim", () => {
      const r = new Request("http://x", { headers: { "x-request-id": "client-abc-123" } })
      expect(extractOrGenerateRequestId(r)).toBe("client-abc-123")
    })
  })

  describe("#given a request without x-request-id", () => {
    test("#when extracted #then returns an idm-prefixed UUID", () => {
      const r = new Request("http://x")
      const id = extractOrGenerateRequestId(r)
      expect(id.startsWith("idm-")).toBe(true)
      expect(id.length).toBeGreaterThan(10)
    })
  })

  describe("#given a request with whitespace-only x-request-id", () => {
    test("#when extracted #then falls back to a generated id", () => {
      const r = new Request("http://x", { headers: { "x-request-id": "   " } })
      const id = extractOrGenerateRequestId(r)
      expect(id.startsWith("idm-")).toBe(true)
    })
  })

  describe("#given a request with an overlong x-request-id (>128)", () => {
    test("#when extracted #then falls back to a generated id", () => {
      const r = new Request("http://x", { headers: { "x-request-id": "a".repeat(200) } })
      const id = extractOrGenerateRequestId(r)
      expect(id.startsWith("idm-")).toBe(true)
    })
  })

  describe("#given two consecutive requests without x-request-id", () => {
    test("#when extracted #then returns distinct generated ids", () => {
      const a = extractOrGenerateRequestId(new Request("http://x"))
      const b = extractOrGenerateRequestId(new Request("http://x"))
      expect(a).not.toBe(b)
    })
  })
})
