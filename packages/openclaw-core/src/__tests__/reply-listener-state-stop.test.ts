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

describe("shouldContinuePolling", () => {
  test("#given pending running and stopped daemon states #when checking poll continuation #then only pending and running continue", () => {
    // given
    const state = createPendingReplyListenerState("startup-token")

    // when/then
    expect(shouldContinuePolling(state)).toBe(true)

    recordReplyListenerPoll(state, 2468)
    expect(shouldContinuePolling(state)).toBe(true)

    const stoppedState = markReplyListenerStopped(state)
    expect(shouldContinuePolling(stoppedState)).toBe(false)
  })
})

describe("isDaemonRunning", () => {
  test("#given a stale pid file #when checking daemon status #then it reports stopped and removes the pid file", async () => {
    // given
    writeFileSync(pidFilePath, "2468")

    // when
    const result = await replyListenerModule.isDaemonRunning()

    // then
    expect(result).toBe(false)
    expect(existsSync(pidFilePath)).toBe(false)
  })
})

describe("reply-listener persisted state readers", () => {
  test("#given malformed persisted daemon files #when reading state config and pid #then null fallbacks are returned", () => {
    // given
    writeFileSync(stateFilePath, "{")
    writeFileSync(configFilePath, "{")
    writeFileSync(pidFilePath, "not-a-pid")

    // when
    const state = readReplyListenerDaemonState()
    const config = readReplyListenerDaemonConfig()
    const pid = readReplyListenerPid()

    // then
    expect(state).toBeNull()
    expect(config).toBeNull()
    expect(pid).toBeNull()
  })
})

describe("stopReplyListener", () => {
  test("#given a live non-daemon process owns the stored pid #when stopping #then it refuses to kill and cleans the stale pid", async () => {
    // given
    const reusedPid = 1357
    livePids.add(reusedPid)
    writeFileSync(pidFilePath, `${reusedPid}`)
    const killSpy = spyOn(process, "kill").mockImplementation(() => true)

    try {
      // when
      const result = await replyListenerModule.stopReplyListener()

      // then
      expect(result.success).toBe(false)
      expect(result.message).toContain(`Refusing to kill PID ${reusedPid}`)
      expect(killSpy).not.toHaveBeenCalled()
      expect(existsSync(pidFilePath)).toBe(false)
    } finally {
      killSpy.mockRestore()
    }
  })

  test("#given a verified daemon process #when stopping #then it sends SIGTERM and persists stopped state", async () => {
    // given
    const daemonPid = 9753
    livePids.add(daemonPid)
    daemonPids.add(daemonPid)
    writeFileSync(pidFilePath, `${daemonPid}`)
    writeFileSync(
      stateFilePath,
      JSON.stringify({ isRunning: true, pid: daemonPid, startupToken: "token", errors: 0 }, null, 2),
    )
    const killSpy = spyOn(process, "kill").mockImplementation(() => true)

    try {
      // when
      const result = await replyListenerModule.stopReplyListener()

      // then
      expect(result.success).toBe(true)
      expect(killSpy).toHaveBeenCalledWith(daemonPid, "SIGTERM")
      expect(existsSync(pidFilePath)).toBe(false)
      expect(result.state).toMatchObject({
        isRunning: false,
        pid: null,
        startupToken: null,
      })
    } finally {
      killSpy.mockRestore()
    }
  })
})
