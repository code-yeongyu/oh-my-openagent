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
  test("#given the module path contains encoded characters #when resolving the daemon script #then the filesystem path is decoded", () => {
    // given
    const currentFilePath = join(tempHome, "openclaw encoded dir", "reply-listener-start.ts")
    const currentFileUrl = pathToFileURL(currentFilePath).href

    // when
    const daemonScript = replyListenerStartModule.resolveReplyListenerDaemonScript(currentFileUrl)

    // then
    expect(daemonScript).toBe(join(dirname(currentFilePath), "daemon.ts"))
  })

  test("#given the source module layout #when resolving the daemon script #then it points at a co-located daemon file", () => {
    // given
    const moduleDir = dirname(fileURLToPath(import.meta.url))
    const startModuleUrl = pathToFileURL(join(moduleDir, "..", "reply-listener-start.ts")).href

    // when
    const daemonScript = replyListenerStartModule.resolveReplyListenerDaemonScript(startModuleUrl)

    // then
    expect(daemonScript).toBe(join(moduleDir, "..", "daemon.ts"))
    expect(existsSync(daemonScript)).toBe(true)
  })

  test("#given a built JavaScript module layout #when resolving the daemon script #then it points at the JavaScript sibling", () => {
    // given
    const builtDir = join(tempHome, "built-openclaw")
    const startModulePath = join(builtDir, "reply-listener-start.js")
    const daemonModulePath = join(builtDir, "daemon.js")
    mkdirSync(builtDir, { recursive: true })
    writeFileSync(startModulePath, "")
    writeFileSync(daemonModulePath, "")

    // when
    const daemonScript = replyListenerStartModule.resolveReplyListenerDaemonScript(pathToFileURL(startModulePath).href)

    // then
    expect(daemonScript).toBe(daemonModulePath)
    expect(existsSync(daemonScript)).toBe(true)
  })
})
