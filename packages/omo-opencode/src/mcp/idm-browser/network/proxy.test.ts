import { describe, test, expect } from "bun:test"
import { buildProxyUrl, rotateSession } from "./proxy"

describe("proxy", () => {
  describe("buildProxyUrl", () => {
    test("#given oxylabs provider #when built #then username includes customer prefix and country", () => {
      const result = buildProxyUrl({
        provider: "oxylabs",
        endpoint: "pr.oxylabs.io:7777",
        username: "myuser",
        password: "mypass",
        country: "IT",
        sessionMode: "sticky",
      })
      expect(result.server).toBe("http://pr.oxylabs.io:7777")
      expect(result.username).toContain("customer-myuser")
      expect(result.username).toContain("cc-IT")
      expect(result.username).toContain("sessid-")
      expect(result.password).toBe("mypass")
    })

    test("#given rotating mode #when built #then no session id in username", () => {
      const result = buildProxyUrl({
        provider: "oxylabs",
        endpoint: "pr.oxylabs.io:7777",
        username: "myuser",
        password: "mypass",
        sessionMode: "rotating",
      })
      expect(result.username).not.toContain("sessid-")
    })

    test("#given custom provider #when built #then uses raw credentials", () => {
      const result = buildProxyUrl({
        provider: "custom",
        endpoint: "my-proxy.com:8080",
        username: "user",
        password: "pass",
      })
      expect(result.username).toBe("user")
      expect(result.server).toBe("http://my-proxy.com:8080")
    })

    test("#given socks5 protocol on oxylabs #when built #then server uses socks5 scheme", () => {
      const result = buildProxyUrl({
        provider: "oxylabs",
        protocol: "socks5",
        endpoint: "pr.oxylabs.io:7000",
        username: "myuser",
        password: "mypass",
        country: "IT",
      })
      expect(result.server).toBe("socks5://pr.oxylabs.io:7000")
      expect(result.username).toContain("customer-myuser")
      expect(result.username).toContain("cc-IT")
    })

    test("#given socks5 protocol on custom provider #when built #then server uses socks5 scheme", () => {
      const result = buildProxyUrl({
        provider: "custom",
        protocol: "socks5",
        endpoint: "my-proxy.com:1080",
        username: "user",
        password: "pass",
      })
      expect(result.server).toBe("socks5://my-proxy.com:1080")
    })

    test("#given no protocol #when built #then defaults to http scheme", () => {
      const result = buildProxyUrl({
        provider: "oxylabs",
        endpoint: "pr.oxylabs.io:7777",
        username: "myuser",
        password: "mypass",
      })
      expect(result.server).toBe("http://pr.oxylabs.io:7777")
    })
  })

  describe("rotateSession", () => {
    test("#given current session #when rotated #then new session id", () => {
      const first = buildProxyUrl({
        provider: "oxylabs",
        endpoint: "pr.oxylabs.io:7777",
        username: "user",
        password: "pass",
      })
      const second = rotateSession(first, {
        provider: "oxylabs",
        endpoint: "pr.oxylabs.io:7777",
        username: "user",
        password: "pass",
      })
      expect(second.sessionId).not.toBe(first.sessionId)
    })
  })
})
