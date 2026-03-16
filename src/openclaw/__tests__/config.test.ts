import { describe, expect, test } from "bun:test"
import { resolveGateway, validateGatewayUrl, normalizeReplyListenerConfig } from "../config"
import type { OpenClawConfig } from "../types"

describe("OpenClaw Config", () => {
  test("resolveGateway resolves HTTP gateway", () => {
    const config: OpenClawConfig = {
      enabled: true,
      gateways: {
        discord: {
          type: "http",
          url: "https://discord.com/api/webhooks/123",
        },
      },
      hooks: {
        "session-start": {
          enabled: true,
          gateway: "discord",
          instruction: "Started session {{sessionId}}",
        },
      },
    } as any

    const resolved = resolveGateway(config, "session-start")
    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayName).toBe("discord")
    expect(resolved?.gateway.url).toBe("https://discord.com/api/webhooks/123")
    expect(resolved?.instruction).toBe("Started session {{sessionId}}")
  })

  test("resolveGateway returns null for disabled config", () => {
    const config: OpenClawConfig = {
      enabled: false,
      gateways: {},
      hooks: {},
    } as any
    expect(resolveGateway(config, "session-start")).toBeNull()
  })

  test("resolveGateway returns null for unknown hook", () => {
    const config: OpenClawConfig = {
      enabled: true,
      gateways: {},
      hooks: {},
    } as any
    expect(resolveGateway(config, "unknown")).toBeNull()
  })

  test("resolveGateway returns null for disabled hook", () => {
    const config: OpenClawConfig = {
      enabled: true,
      gateways: { g: { url: "https://example.com" } },
      hooks: {
        event: { enabled: false, gateway: "g", instruction: "i" },
      },
    } as any
    expect(resolveGateway(config, "event")).toBeNull()
  })

  test("validateGatewayUrl allows HTTPS", () => {
    expect(validateGatewayUrl("https://example.com")).toBe(true)
  })

  test("validateGatewayUrl rejects HTTP remote", () => {
    expect(validateGatewayUrl("http://example.com")).toBe(false)
  })

  test("validateGatewayUrl allows HTTP localhost", () => {
    expect(validateGatewayUrl("http://localhost:3000")).toBe(true)
    expect(validateGatewayUrl("http://127.0.0.1:3000")).toBe(true)
  })
})
