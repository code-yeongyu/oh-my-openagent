/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInfo } from "./system-plugin"
import { getPluginInfo } from "./system-plugin"
import { checkSystem } from "./system"

const testConfigDirs: string[] = []
let originalConfigDir: string | undefined

function createTestConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tuple-doctor-"))
  testConfigDirs.push(dir)
  return dir
}

function createSystemDeps(pluginInfo: PluginInfo) {
  return {
    findOpenCodeBinary: async () => ({ binary: "opencode" as const, path: "/usr/local/bin/opencode" }),
    getOpenCodeVersion: async () => "1.0.200",
    compareVersions: () => true,
    getPluginInfo: () => pluginInfo,
    getLoadedPluginVersion: () => ({
      cacheDir: "/tmp/cache",
      cachePackagePath: "/tmp/package.json",
      installedPackagePath: "/tmp/node_modules/oh-my-openagent/package.json",
      expectedVersion: "3.11.0",
      loadedVersion: "3.11.0",
    }),
    getLatestPluginVersion: async () => null,
    getSuggestedInstallTag: () => "latest",
    configExists: () => true,
    readConfigFile: () => "{}",
    parseConfigContent: () => ({}),
  }
}

beforeEach(() => {
  originalConfigDir = process.env.OPENCODE_CONFIG_DIR
})

afterEach(() => {
  for (const dir of testConfigDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
  if (originalConfigDir === undefined) delete process.env.OPENCODE_CONFIG_DIR
  else process.env.OPENCODE_CONFIG_DIR = originalConfigDir
})

describe("getPluginInfo - tuple plugin entries", () => {
  it("#given a config mixing a tuple entry and our entry #when reading plugin info #then our entry is still detected", () => {
    // given
    const testConfigDir = createTestConfigDir()
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    writeFileSync(
      join(testConfigDir, "opencode.json"),
      JSON.stringify({ plugin: [["some-plugin@1.2.3", { enabled: true }], "oh-my-openagent@3.11.0"] }, null, 2),
    )

    // when
    const info = getPluginInfo()

    // then
    expect(info.registered).toBe(true)
    expect(info.entry).toBe("oh-my-openagent@3.11.0")
    expect(info.pinnedVersion).toBe("3.11.0")
  })

  it("#given our plugin declared as a tuple #when reading plugin info #then the pinned version is read from the entry name", () => {
    // given
    const testConfigDir = createTestConfigDir()
    process.env.OPENCODE_CONFIG_DIR = testConfigDir
    writeFileSync(
      join(testConfigDir, "opencode.json"),
      JSON.stringify({ plugin: [["oh-my-openagent@3.11.0", { verbose: true }]] }, null, 2),
    )

    // when
    const info = getPluginInfo()

    // then
    expect(info.registered).toBe(true)
    expect(info.entry).toEqual(["oh-my-openagent@3.11.0", { verbose: true }])
    expect(info.pinnedVersion).toBe("3.11.0")
    expect(info.isPinned).toBe(true)
  })
})

describe("checkSystem - tuple plugin entries", () => {
  it("#given a legacy tuple entry #when running the system check #then it warns about the legacy name without throwing", async () => {
    // given
    const deps = createSystemDeps({
      registered: true,
      entry: ["oh-my-opencode@3.10.0", { verbose: true }],
      isPinned: true,
      pinnedVersion: "3.10.0",
      configPath: null,
      isLocalDev: false,
    })

    // when
    const result = await checkSystem(deps)

    // then
    const legacyIssue = result.issues.find((issue) => issue.title === "Using legacy package name")
    expect(legacyIssue).toBeDefined()
    expect(legacyIssue?.fix).toContain("oh-my-openagent@3.10.0")
  })

  it("#given a canonical tuple entry #when running the system check #then no legacy warning is raised", async () => {
    // given
    const deps = createSystemDeps({
      registered: true,
      entry: ["oh-my-openagent@3.11.0", { verbose: true }],
      isPinned: true,
      pinnedVersion: "3.11.0",
      configPath: null,
      isLocalDev: false,
    })

    // when
    const result = await checkSystem(deps)

    // then
    expect(result.issues.find((issue) => issue.title === "Using legacy package name")).toBeUndefined()
  })
})
