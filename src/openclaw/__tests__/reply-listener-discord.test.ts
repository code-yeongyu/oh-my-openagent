import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { ReplyListenerRateLimiter } from "../reply-listener-injection"
import { pollDiscordReplies } from "../reply-listener-discord"
import * as injectionModule from "../reply-listener-injection"
import * as sessionRegistryModule from "../session-registry"
import type { ReplyListenerDaemonState } from "../reply-listener-state"
import type { OpenClawConfig } from "../types"

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalFetch = globalThis.fetch

const tempHome = mkdtempSync(join(tmpdir(), "openclaw-reply-listener-discord-"))
const stateDir = join(tempHome, ".omx", "state")
const stateFilePath = join(stateDir, "reply-listener-state.json")

function createConfig(): OpenClawConfig {
  return {
    enabled: true,
    gateways: {
      gateway: {
        type: "http",
        url: "https://example.com",
        method: "POST",
      },
    },
    hooks: {},
    replyListener: {
      discordBotToken: "discord-token",
      discordChannelId: "channel-1",
      authorizedDiscordUserIds: ["user-1"],
      pollIntervalMs: 10,
      rateLimitPerMinute: 10,
      maxMessageLength: 500,
      includePrefix: true,
    },
  }
}

function createState(): ReplyListenerDaemonState {
  return {
    isRunning: true,
    pid: 1234,
    startedAt: "2026-04-07T00:00:00.000Z",
    startupToken: "startup-token",
    configSignature: null,
    lastPollAt: "2026-04-07T00:00:01.000Z",
    telegramLastUpdateId: null,
    discordLastMessageId: null,
    lastDiscordMessageId: null,
    messagesSeen: 0,
    messagesInjected: 0,
    errors: 0,
  }
}

describe("pollDiscordReplies", () => {
  beforeEach(() => {
    process.env.HOME = tempHome
    process.env.USERPROFILE = tempHome
    globalThis.fetch = originalFetch
    rmSync(stateDir, { recursive: true, force: true })
    mkdirSync(stateDir, { recursive: true })
  })

  afterEach(() => {
    mock.restore()
    globalThis.fetch = originalFetch
  })

  test("records HTTP failures in daemon state when Discord returns non-ok", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("unauthorized", {
        status: 401,
      }),
    )

    const state = createState()

    await pollDiscordReplies(createConfig(), state, new ReplyListenerRateLimiter(10))

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(state.errors).toBe(1)
    expect(state.lastError).toBe("Discord API error: HTTP 401")
    expect(existsSync(stateFilePath)).toBe(true)

    const persistedState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as ReplyListenerDaemonState
    expect(persistedState.errors).toBe(1)
    expect(persistedState.lastError).toBe("Discord API error: HTTP 401")
    expect(persistedState.messagesSeen).toBe(0)
  })

  test("increments messagesInjected when a Discord reply matches a registered message", async () => {
    const fetchSpy = spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([
            {
              id: "incoming-1",
              content: "Ship it",
              author: { id: "user-1" },
              message_reference: { message_id: "outbound-1" },
            },
          ]),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const lookupSpy = spyOn(sessionRegistryModule, "lookupByMessageId").mockReturnValue({
      sessionId: "ses-1",
      tmuxSession: "session-1",
      tmuxPaneId: "%7",
      projectPath: "/tmp/project",
      platform: "discord-bot",
      messageId: "outbound-1",
      createdAt: "2026-04-07T00:00:00.000Z",
    })
    const injectSpy = spyOn(injectionModule, "injectReplyIntoPane").mockResolvedValue(true)

    const state = createState()

    await pollDiscordReplies(createConfig(), state, new ReplyListenerRateLimiter(10))

    expect(lookupSpy).toHaveBeenCalledWith("discord-bot", "outbound-1")
    expect(injectSpy).toHaveBeenCalledWith("%7", "Ship it", "discord", createConfig())
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(state.messagesSeen).toBe(1)
    expect(state.messagesInjected).toBe(1)
    expect(state.lastDiscordMessageId).toBe("incoming-1")
  })
})
