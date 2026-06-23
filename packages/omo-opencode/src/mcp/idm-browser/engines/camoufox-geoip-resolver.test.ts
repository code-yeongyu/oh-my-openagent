import { describe, test, expect } from "bun:test"
import type { ProxyConfig, GeoIpLookupResult } from "./camoufox-geoip-resolver"

describe("camoufox-geoip-resolver", () => {
  describe("ProxyConfig type", () => {
    test("#given string url form #when typed #then accepts http url with creds", () => {
      const cfg: ProxyConfig = "http://user:pass@pr.oxylabs.io:7777"
      expect(typeof cfg).toBe("string")
    })

    test("#given object form #when typed #then accepts server username password", () => {
      const cfg: ProxyConfig = {
        server: "http://pr.oxylabs.io:7777",
        username: "customer-foo-cc-IT-sessid-xyz",
        password: "secret",
      }
      expect(cfg.server).toBe("http://pr.oxylabs.io:7777")
    })

    test("#given object form without creds #when typed #then compiles", () => {
      const cfg: ProxyConfig = { server: "http://example.com:8080" }
      expect(cfg.server).toBe("http://example.com:8080")
    })
  })

  describe("GeoIpLookupResult type", () => {
    test("#given lookup result #when typed #then has ip string and resolvedAt number", () => {
      const result: GeoIpLookupResult = { ip: "203.0.113.42", resolvedAt: Date.now() }
      expect(result.ip).toBe("203.0.113.42")
      expect(typeof result.resolvedAt).toBe("number")
    })
  })
})
