/// <reference types="bun-types" />

import { beforeEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  NO_PROJECT_SOURCES_FINGERPRINT,
  fingerprintProjectSources,
  getProcessConfigCacheEntry,
  isProcessConfigCacheDisabled,
  resetProcessConfigCacheForTests,
  setProcessConfigCacheEntry,
} from "./process-config-cache"

describe("process-config-cache", () => {
  let tempRoot: string

  beforeEach(() => {
    resetProcessConfigCacheForTests()
    delete process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE
    tempRoot = mkdtempSync(join(tmpdir(), "omo-pcc-"))
  })

  test("empty folder fingerprints to the shared no-project-sources constant", () => {
    const emptyFolder = join(tempRoot, "empty-chat-folder")
    mkdirSync(emptyFolder)

    expect(fingerprintProjectSources(emptyFolder)).toBe(NO_PROJECT_SOURCES_FINGERPRINT)
  })

  test("two distinct empty folders share the same fingerprint", () => {
    const folderA = join(tempRoot, "chat-a")
    const folderB = join(tempRoot, "chat-b")
    mkdirSync(folderA)
    mkdirSync(folderB)

    expect(fingerprintProjectSources(folderA)).toBe(fingerprintProjectSources(folderB))
  })

  test("a folder with project sources is keyed by directory and content", () => {
    const folderA = join(tempRoot, "project-a")
    const folderB = join(tempRoot, "project-b")
    mkdirSync(join(folderA, ".claude", "agents"), { recursive: true })
    writeFileSync(join(folderA, ".claude", "agents", "helper.md"), "agent")
    mkdirSync(join(folderB, ".claude", "agents"), { recursive: true })
    writeFileSync(join(folderB, ".claude", "agents", "helper.md"), "agent")

    const fingerprintA = fingerprintProjectSources(folderA)
    const fingerprintB = fingerprintProjectSources(folderB)

    // same content, different directory -> different keys (per-folder isolation)
    expect(fingerprintA?.startsWith("dir:")).toBe(true)
    expect(fingerprintB?.startsWith("dir:")).toBe(true)
    expect(fingerprintA).not.toBe(fingerprintB)
  })

  test("adding or removing a project source entry changes the fingerprint", () => {
    const folder = join(tempRoot, "project")
    mkdirSync(join(folder, ".claude"), { recursive: true })
    const before = fingerprintProjectSources(folder)

    // a new entry under a project root changes the directory listing
    mkdirSync(join(folder, ".claude", "agents"))
    const afterAdd = fingerprintProjectSources(folder)
    expect(afterAdd).not.toBe(before)

    // removing the entry changes the fingerprint again (the directory stat
    // keeps the mutation), which still invalidates the cache correctly.
    rmSync(join(folder, ".claude", "agents"), { recursive: true, force: true })
    expect(fingerprintProjectSources(folder)).not.toBe(afterAdd)
  })

  test("entries round-trip and reset clears them", () => {
    setProcessConfigCacheEntry("pluginComponents", { key: "k1", value: { hello: 1 } })
    expect(getProcessConfigCacheEntry("pluginComponents")?.key).toBe("k1")

    resetProcessConfigCacheForTests()
    expect(getProcessConfigCacheEntry("pluginComponents")).toBeUndefined()
  })

  test("OMO_DISABLE_PROCESS_CONFIG_CACHE=1 disables reads and writes", () => {
    process.env.OMO_DISABLE_PROCESS_CONFIG_CACHE = "1"
    expect(isProcessConfigCacheDisabled()).toBe(true)

    setProcessConfigCacheEntry("pluginComponents", { key: "k1", value: {} })
    expect(getProcessConfigCacheEntry("pluginComponents")).toBeUndefined()
  })

  test("state survives a fresh import of the module (module re-import safety)", async () => {
    setProcessConfigCacheEntry("globalCommandSources", { key: "k2", value: { n: 2 } })
    // A per-location plugin module re-import in the same process must keep the
    // cache: it lives on globalThis behind a registered symbol, not module scope.
    const moduleUrl = new URL("./process-config-cache.ts", import.meta.url).href + "?reimport=1"
    await import(moduleUrl)
    expect(getProcessConfigCacheEntry("globalCommandSources")?.key).toBe("k2")
  })
})
