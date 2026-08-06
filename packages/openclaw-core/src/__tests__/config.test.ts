import { describe, expect, test } from "bun:test"
import { resolveGateway, validateGatewayUrl, normalizeReplyListenerConfig } from "../config"
import type { OpenClawConfig } from "../types"

describe("OpenClaw Config", () => {
  test("resolveGateway resolves HTTP gateway", () => {
    const config = {
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
    } satisfies OpenClawConfig

    const resolved = resolveGateway(config, "session-start")
    expect(resolved).not.toBeNull()
    expect(resolved?.gatewayName).toBe("discord")
    expect(resolved?.gateway.url).toBe("https://discord.com/api/webhooks/123")
    expect(resolved?.instruction).toBe("Started session {{sessionId}}")
  })

  test("resolveGateway returns null for disabled config", () => {
    const config = {
      enabled: false,
      gateways: {},
      hooks: {},
    } satisfies OpenClawConfig
    expect(resolveGateway(config, "session-start")).toBeNull()
  })

  test("resolveGateway returns null for unknown hook", () => {
    const config = {
      enabled: true,
      gateways: {},
      hooks: {},
    } satisfies OpenClawConfig
    expect(resolveGateway(config, "unknown")).toBeNull()
  })

  test("resolveGateway returns null for disabled hook", () => {
    const config = {
      enabled: true,
      gateways: { g: { type: "http", url: "https://example.com" } },
      hooks: {
        event: { enabled: false, gateway: "g", instruction: "i" },
      },
    } satisfies OpenClawConfig
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

  test("normalizeReplyListenerConfig normalizes nested reply listener fields", () => {
    const config = normalizeReplyListenerConfig({
      enabled: true,
      gateways: {},
      hooks: {},
      replyListener: {
        discordBotToken: "discord-token",
        discordChannelId: "channel-id",
        authorizedDiscordUserIds: ["user-1", "", "user-2"],
        pollIntervalMs: 100,
        rateLimitPerMinute: 0,
        maxMessageLength: 9000,
        includePrefix: false,
      },
    })

    expect(config.replyListener).toEqual({
      discordBotToken: "discord-token",
      discordChannelId: "channel-id",
      authorizedDiscordUserIds: ["user-1", "user-2"],
      pollIntervalMs: 500,
      rateLimitPerMinute: 1,
      maxMessageLength: 4000,
      includePrefix: false,
    })
  })

  test("gateway timeout remains optional so env fallback can apply", () => {
    const parsed: OpenClawConfig = {
      enabled: true,
      gateways: {
        command: {
          type: "command",
          command: "echo hi",
        },
      },
      hooks: {},
    }

    expect(parsed.gateways.command.timeout).toBeUndefined()
  })
})
