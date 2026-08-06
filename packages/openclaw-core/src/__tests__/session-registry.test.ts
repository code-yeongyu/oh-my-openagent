import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import * as sessionRegistryModule from "../session-registry"
import { getRegistryPath } from "../session-registry-paths"
import type { SessionMapping } from "../session-registry"

const originalXdgDataHome = process.env.XDG_DATA_HOME
const tempDataHome = mkdtempSync(join(tmpdir(), "openclaw-session-registry-"))
const registryDir = join(tempDataHome, "opencode", "storage", "openclaw")
const registryPath = join(registryDir, "reply-session-registry.jsonl")
const lockPath = join(registryDir, "reply-session-registry.lock")

function createMapping(overrides: Partial<SessionMapping> = {}): SessionMapping {
  return {
    sessionId: "session-1",
    tmuxSession: "tmux-main",
    tmuxPaneId: "%1",
    projectPath: "/tmp/project",
    platform: "discord-bot",
    messageId: "message-1",
    createdAt: "2026-04-07T00:00:00.000Z",
    ...overrides,
  }
}

function resetRegistry(): void {
  rmSync(registryDir, { recursive: true, force: true })
  mkdirSync(registryDir, { recursive: true })
}

beforeEach(() => {
  process.env.XDG_DATA_HOME = tempDataHome
  resetRegistry()
})

afterAll(() => {
  if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME
  else process.env.XDG_DATA_HOME = originalXdgDataHome

  rmSync(tempDataHome, { recursive: true, force: true })
})

describe("session-registry", () => {
  test("appends mappings and loads only valid JSONL records", () => {
    // given
    const firstMapping = createMapping()
    const secondMapping = createMapping({
      sessionId: "session-2",
      messageId: "message-2",
      channelId: "channel-2",
      threadId: "thread-2",
    })

    // when
    expect(sessionRegistryModule.registerMessage(firstMapping)).toBe(true)
    writeFileSync(registryPath, `${readFileSync(registryPath, "utf-8")}not-json\n`)
    expect(sessionRegistryModule.registerMessage(secondMapping)).toBe(true)

    // then
    expect(sessionRegistryModule.loadAllMappings()).toEqual([firstMapping, secondMapping])
    expect(existsSync(lockPath)).toBe(false)
  })

  test("keeps the registry path stable after first path resolution", () => {
    // given
    const firstResolvedPath = getRegistryPath()
    const otherDataHome = mkdtempSync(join(tmpdir(), "openclaw-session-registry-other-"))
    const mapping = createMapping()

    try {
      process.env.XDG_DATA_HOME = otherDataHome

      // when
      expect(sessionRegistryModule.registerMessage(mapping)).toBe(true)

      // then
      expect(firstResolvedPath).toBe(registryPath)
      expect(readFileSync(registryPath, "utf-8")).toContain(JSON.stringify(mapping))
      expect(
        existsSync(
          join(
            otherDataHome,
            "opencode",
            "storage",
            "openclaw",
            "reply-session-registry.jsonl",
          ),
        ),
      ).toBe(false)
    } finally {
      rmSync(otherDataHome, { recursive: true, force: true })
      process.env.XDG_DATA_HOME = tempDataHome
    }
  })

  test("#given XDG_DATA_HOME #when resolving registry paths #then the path bytes match OpenCode storage plus openclaw", () => {
    // given
    const mapping = createMapping()

    // when
    expect(sessionRegistryModule.registerMessage(mapping)).toBe(true)

    // then
    expect(getRegistryPath()).toBe(join(tempDataHome, "opencode", "storage", "openclaw", "reply-session-registry.jsonl"))
    expect(existsSync(registryPath)).toBe(true)
  })

  test("#given a stale registry lock from a dead process #when registering #then it recovers and releases the lock", () => {
    // given
    mkdirSync(dirname(lockPath), { recursive: true })
    writeFileSync(lockPath, JSON.stringify({ pid: 999_999_999, acquiredAt: 0, token: "stale-token" }))
    const oldTimestamp = new Date(Date.now() - 20_000)
    utimesSync(lockPath, oldTimestamp, oldTimestamp)

    // when
    const result = sessionRegistryModule.registerMessage(createMapping())

    // then
    expect(result).toBe(true)
    expect(sessionRegistryModule.loadAllMappings()).toHaveLength(1)
    expect(existsSync(lockPath)).toBe(false)
  })

  test("looks up mappings by platform and message id", () => {
    // given
    const discordMapping = createMapping({ platform: "discord-bot", messageId: "message-1" })
    const telegramMapping = createMapping({ platform: "telegram", messageId: "message-1" })

    sessionRegistryModule.registerMessage(discordMapping)
    sessionRegistryModule.registerMessage(telegramMapping)

    // when/then
    expect(sessionRegistryModule.lookupByMessageId("telegram", "message-1")).toEqual(telegramMapping)
    expect(sessionRegistryModule.lookupByMessageId("discord-bot", "missing")).toBeNull()
  })

  test("removes mappings by session and pane while preserving other records", () => {
    // given
    const keepMapping = createMapping({ sessionId: "session-keep", tmuxPaneId: "%keep", messageId: "keep" })
    const removeBySessionMapping = createMapping({ sessionId: "session-remove", tmuxPaneId: "%session", messageId: "session" })
    const removeByPaneMapping = createMapping({ sessionId: "session-pane", tmuxPaneId: "%remove", messageId: "pane" })

    sessionRegistryModule.registerMessage(keepMapping)
    sessionRegistryModule.registerMessage(removeBySessionMapping)
    sessionRegistryModule.registerMessage(removeByPaneMapping)

    // when
    sessionRegistryModule.removeSession("session-remove")
    sessionRegistryModule.removeMessagesByPane("%remove")

    // then
    expect(sessionRegistryModule.loadAllMappings()).toEqual([keepMapping])
  })

  test("prunes mappings older than the registry retention window", () => {
    // given
    const freshMapping = createMapping({ sessionId: "fresh", messageId: "fresh", createdAt: new Date().toISOString() })
    const staleMapping = createMapping({ sessionId: "stale", messageId: "stale", createdAt: "2026-01-01T00:00:00.000Z" })
    const invalidDateMapping = createMapping({ sessionId: "invalid", messageId: "invalid", createdAt: "not-a-date" })

    sessionRegistryModule.registerMessage(freshMapping)
    sessionRegistryModule.registerMessage(staleMapping)
    sessionRegistryModule.registerMessage(invalidDateMapping)

    // when
    sessionRegistryModule.pruneStale()

    // then
    expect(sessionRegistryModule.loadAllMappings()).toEqual([freshMapping])
  })
})
