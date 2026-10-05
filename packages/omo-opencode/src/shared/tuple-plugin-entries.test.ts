import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { checkForLegacyPluginEntry } from "./legacy-plugin-warning"
import { logLegacyPluginStartupWarning } from "./log-legacy-plugin-startup-warning"
import { migrateLegacyPluginEntry } from "./migrate-legacy-plugin-entry"
import { isCanonicalEntry, isLegacyEntry, toCanonicalEntry } from "./plugin-entry-migrator"

const testConfigDirs: string[] = []

function createTestConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-tuple-legacy-"))
  testConfigDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of testConfigDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("plugin entry migrator - tuple entries", () => {
  it("#given a tuple entry #when classifying it #then it matches on the entry name instead of throwing", () => {
    // given
    const legacyTuple = ["oh-my-opencode@3.10.0", { verbose: true }] as const
    const canonicalTuple = ["oh-my-openagent@3.11.0", { verbose: true }] as const
    const foreignTuple = ["some-plugin@1.2.3", { enabled: true }] as const

    // when / then
    expect(isLegacyEntry(legacyTuple)).toBe(true)
    expect(isLegacyEntry(foreignTuple)).toBe(false)
    expect(isCanonicalEntry(canonicalTuple)).toBe(true)
    expect(isCanonicalEntry(foreignTuple)).toBe(false)
  })

  it("#given a legacy tuple entry #when converting to canonical #then the options object is preserved", () => {
    // given
    const legacyTuple = ["oh-my-opencode@3.10.0", { verbose: true }] as const

    // when
    const converted = toCanonicalEntry(legacyTuple)

    // then
    expect(converted).toEqual(["oh-my-openagent@3.10.0", { verbose: true }])
  })
})

describe("checkForLegacyPluginEntry - tuple entries", () => {
  it("#given a config mixing a tuple entry and a legacy entry #when checking #then the legacy entry is still detected", () => {
    // given
    const testConfigDir = createTestConfigDir()
    writeFileSync(
      join(testConfigDir, "opencode.json"),
      JSON.stringify({ plugin: [["some-plugin@1.2.3", { enabled: true }], "oh-my-opencode"] }, null, 2),
    )

    // when
    const result = checkForLegacyPluginEntry(testConfigDir)

    // then
    expect(result.hasLegacyEntry).toBe(true)
    expect(result.legacyEntries).toEqual(["oh-my-opencode"])
    expect(result.configPath).toBe(join(testConfigDir, "opencode.json"))
  })

  it("#given a legacy tuple entry #when checking #then it is reported as a legacy entry", () => {
    // given
    const testConfigDir = createTestConfigDir()
    writeFileSync(
      join(testConfigDir, "opencode.json"),
      JSON.stringify({ plugin: [["oh-my-opencode@3.10.0", { verbose: true }]] }, null, 2),
    )

    // when
    const result = checkForLegacyPluginEntry(testConfigDir)

    // then
    expect(result.hasLegacyEntry).toBe(true)
    expect(result.legacyEntries).toEqual([["oh-my-opencode@3.10.0", { verbose: true }]])
  })
})

describe("logLegacyPluginStartupWarning - tuple entries", () => {
  it("#given legacy tuple entries #when warning at startup #then it logs canonical tuples instead of throwing", () => {
    // given
    const consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})
    const logged: Array<{ message: string; payload: unknown }> = []

    try {
      // when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: () => ({
          hasLegacyEntry: true,
          hasCanonicalEntry: false,
          legacyEntries: [["oh-my-opencode@3.10.0", { verbose: true }]],
          configPath: "/tmp/opencode.json",
        }),
        log: (message: string, payload?: unknown) => {
          logged.push({ message, payload })
        },
        migrateLegacyPluginEntry: () => true,
      })

      // then
      expect(logged).toHaveLength(1)
      expect(logged[0]?.payload).toEqual({
        legacyEntries: [["oh-my-opencode@3.10.0", { verbose: true }]],
        suggestedEntries: [["oh-my-openagent@3.10.0", { verbose: true }]],
        hasCanonicalEntry: false,
      })
      expect(consoleWarnSpy).toHaveBeenCalled()
    } finally {
      consoleWarnSpy.mockRestore()
    }
  })
})

describe("migrateLegacyPluginEntry - tuple entries", () => {
  it("#given a jsonc config with a legacy tuple entry #when migrating #then the tuple keeps its options object", () => {
    // given
    const testConfigDir = createTestConfigDir()
    const configPath = join(testConfigDir, "opencode.jsonc")
    writeFileSync(configPath, '{\n  // keep this comment\n  "plugin": [["oh-my-opencode@3.10.0", { "verbose": true }]]\n}\n')

    // when
    const migrated = migrateLegacyPluginEntry(configPath)

    // then
    expect(migrated).toBe(true)
    const savedContent = readFileSync(configPath, "utf-8")
    expect(savedContent).not.toContain("[object Object]")
    const savedConfig = JSON.parse(
      savedContent.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n"),
    )
    expect(savedConfig.plugin).toEqual([["oh-my-openagent@3.10.0", { verbose: true }]])
  })
})
