/// <reference path="../../../../bun-test.d.ts" />

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { dirname, join } from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { shouldContinuePolling } from "../reply-listener-poll-loop"
import {
  createPendingReplyListenerState,
  markReplyListenerStopped,
  recordReplyListenerPoll,
  readReplyListenerDaemonConfig,
  readReplyListenerDaemonState,
  readReplyListenerPid,
} from "../reply-listener-state"
import type { OpenClawConfig } from "../types"

interface MockSpawnProcess {
  pid: number
  unref(): void
}

type SpawnImplementation = (...args: unknown[]) => MockSpawnProcess

const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
const originalStartupTimeout = process.env.OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS

const tempHome = mkdtempSync(join(tmpdir(), "openclaw-reply-listener-"))
const stateDir = join(tempHome, ".omo", "openclaw", "state")
const configFilePath = join(stateDir, "reply-listener-config.json")
const stateFilePath = join(stateDir, "reply-listener-state.json")
const pidFilePath = join(stateDir, "reply-listener.pid")

const livePids = new Set<number>()
const daemonPids = new Set<number>()

let spawnImplementation: SpawnImplementation = () => ({
  pid: 0,
  unref() {
  },
})

let replyListenerModule: typeof import("../reply-listener")
let replyListenerStartModule: typeof import("../reply-listener-start")

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

function getReplyListenerConfigSignature(config: OpenClawConfig): string {
  return JSON.stringify(config.replyListener ?? null)
}

function resetStateDir(): void {
  rmSync(stateDir, { recursive: true, force: true })
  mkdirSync(stateDir, { recursive: true })
  livePids.clear()
  daemonPids.clear()
}

beforeAll(async () => {
  process.env.HOME = tempHome
  process.env.USERPROFILE = tempHome

  mock.module("../reply-listener-spawn", () => ({
    spawnReplyListenerDaemon: (...args: unknown[]) => spawnImplementation(...args),
  }))

  mock.module("../reply-listener-process", () => ({
    isReplyListenerProcessRunning: (pid: number) => livePids.has(pid),
    isReplyListenerDaemonProcess: async (pid: number) => daemonPids.has(pid),
  }))

  mock.module("../tmux", () => ({
    isTmuxAvailable: async () => true,
    captureTmuxPane: async () => "",
    analyzePaneContent: () => ({ confidence: 1 }),
    sendToPane: async () => true,
  }))

  replyListenerModule = await import("../reply-listener")
  replyListenerStartModule = await import("../reply-listener-start")
})

beforeEach(() => {
  resetStateDir()
})

afterEach(() => {
  resetStateDir()
  process.env.OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS = "25"
})

afterAll(() => {
  if (originalHome === undefined) delete process.env.HOME
  else process.env.HOME = originalHome

  if (originalUserProfile === undefined) delete process.env.USERPROFILE
  else process.env.USERPROFILE = originalUserProfile

  if (originalStartupTimeout === undefined) {
    delete process.env.OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS
  } else {
    process.env.OMO_OPENCLAW_REPLY_LISTENER_STARTUP_TIMEOUT_MS = originalStartupTimeout
  }

  rmSync(tempHome, { recursive: true, force: true })
  mock.restore()
})

describe("startReplyListener", () => {
  test("returns the child's ready state only after detached startup reaches the poll loop", async () => {
    const killSpy = spyOn(process, "kill").mockImplementation((pid: number | string) => {
      if (pid === 4321) {
        return true
      }
      return true
    })

    spawnImplementation = () => {
      const markReady = (): void => {
        if (!existsSync(stateFilePath)) {
          setTimeout(markReady, 5)
          return
        }

        const pendingState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as Record<string, unknown>
        writeFileSync(
          stateFilePath,
          JSON.stringify(
            {
              ...pendingState,
              isRunning: true,
              pid: 4321,
              lastPollAt: "2026-04-07T00:00:00.000Z",
              discordLastMessageId: "discord-99",
              messagesSeen: 4,
            },
            null,
            2,
          ),
        )
      }

      setTimeout(markReady, 5)

      return {
        pid: 4321,
        unref() {
        },
      }
    }

    const result = await replyListenerModule.startReplyListener(createConfig())

    try {
      expect(result.success).toBe(true)
      expect(result.state).toMatchObject({
        isRunning: true,
        pid: 4321,
        lastPollAt: "2026-04-07T00:00:00.000Z",
        discordLastMessageId: "discord-99",
        lastDiscordMessageId: "discord-99",
        messagesSeen: 4,
      })

      const persistedState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as Record<string, unknown>
      expect(persistedState.messagesSeen).toBe(4)
      expect(persistedState.discordLastMessageId).toBe("discord-99")
      expect(persistedState.lastDiscordMessageId).toBe("discord-99")
    } finally {
      killSpy.mockRestore()
    }
  })

  test("does not report success or leave stale running state when detached child never becomes ready", async () => {
    spawnImplementation = () => ({
      pid: 9876,
      unref() {
      },
    })

    const result = await replyListenerModule.startReplyListener(createConfig())

    expect(result.success).toBe(false)
    expect(result.message).toContain("ready")
    expect(existsSync(pidFilePath)).toBe(false)

    if (existsSync(stateFilePath)) {
      const persistedState = JSON.parse(readFileSync(stateFilePath, "utf-8")) as Record<string, unknown>
      expect(persistedState.isRunning).toBe(false)
      expect(persistedState.pid).toBeNull()
    }
  })

  test("does not restart an already running daemon when persisted config already matches", async () => {
    const existingPid = 3210
    livePids.add(existingPid)
    daemonPids.add(existingPid)
    writeFileSync(pidFilePath, `${existingPid}`)
    writeFileSync(
      stateFilePath,
      JSON.stringify({ isRunning: true, pid: existingPid, startupToken: "existing", errors: 0 }, null, 2),
    )
    writeFileSync(configFilePath, JSON.stringify({ ...createConfig(), replyListener: { ...createConfig().replyListener, pollIntervalMs: 500 } }, null, 2))

    let spawnCalls = 0
    spawnImplementation = () => {
      spawnCalls += 1
      return {
        pid: 9999,
        unref() {
        },
      }
    }

    const killSpy = spyOn(process, "kill").mockImplementation(() => true)

    try {
      const result = await replyListenerModule.startReplyListener(createConfig())

      expect(result.success).toBe(true)
      expect(result.message).toContain("already running")
      expect(spawnCalls).toBe(0)
      expect(killSpy).not.toHaveBeenCalled()
    } finally {
      killSpy.mockRestore()
    }
  })

})
