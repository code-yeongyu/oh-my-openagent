/// <reference path="../../bun-test.d.ts" />

import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { LegacyPluginCheckResult } from "./legacy-plugin-warning"
import { logLegacyPluginStartupWarning } from "./log-legacy-plugin-startup-warning"

function createLegacyPluginCheckResult(
  overrides: Partial<LegacyPluginCheckResult> = {},
): LegacyPluginCheckResult {
  return {
    hasLegacyEntry: false,
    hasCanonicalEntry: false,
    legacyEntries: [],
    configPath: null,
    ...overrides,
  }
}

const mockCheckForLegacyPluginEntry = mock(() => createLegacyPluginCheckResult())
const mockLog = mock(() => {})
const mockMigrateLegacyPluginEntry = mock(() => false)
let consoleWarnSpy: ReturnType<typeof spyOn>

afterAll(() => {
  mock.restore()
})

async function importFreshStartupWarningModule(): Promise<typeof import("./log-legacy-plugin-startup-warning")> {
  consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})
  return { logLegacyPluginStartupWarning }
}

describe("logLegacyPluginStartupWarning", () => {
  beforeEach(() => {
    mockCheckForLegacyPluginEntry.mockReset()
    mockLog.mockReset()
    mockMigrateLegacyPluginEntry.mockReset()
    consoleWarnSpy = spyOn(console, "warn").mockImplementation(() => {})

    mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult())
    mockMigrateLegacyPluginEntry.mockReturnValue(false)
  })

  afterEach(() => {
    consoleWarnSpy?.mockRestore()
  })

  describe("#given OpenCode config contains legacy plugin entries", () => {
    it("#then logs the legacy entries with canonical replacements", async () => {
      //#given
      mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult({
        hasLegacyEntry: true,
        legacyEntries: ["oh-my-opencode", "oh-my-opencode@3.13.1"],
        configPath: "/tmp/opencode.json",
      }))
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
        log: mockLog,
        migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
      })

      //#then
      expect(mockLog).toHaveBeenCalledTimes(1)
      expect(mockLog).toHaveBeenCalledWith(
        "[OhMyOpenCodePlugin] Legacy plugin entry detected in OpenCode config",
        {
          legacyEntries: ["oh-my-opencode", "oh-my-opencode@3.13.1"],
          suggestedEntries: ["oh-my-openagent", "oh-my-openagent@3.13.1"],
          hasCanonicalEntry: false,
        },
      )
    })

    it("#then emits console.warn about the rename", async () => {
      //#given
      mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult({
        hasLegacyEntry: true,
        legacyEntries: ["oh-my-opencode@latest"],
        configPath: "/tmp/opencode.json",
      }))
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
        log: mockLog,
        migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
      })

      //#then
      expect(consoleWarnSpy).toHaveBeenCalled()
      const firstCall = consoleWarnSpy.mock.calls[0]?.[0] as string
      expect(firstCall).toContain("oh-my-opencode")
      expect(firstCall).toContain("oh-my-openagent")
    })

    it("#then attempts auto-migration of the opencode.json", async () => {
      //#given
      mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult({
        hasLegacyEntry: true,
        legacyEntries: ["oh-my-opencode"],
        configPath: "/tmp/opencode.json",
      }))
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
        log: mockLog,
        migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
      })

      //#then
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith("/tmp/opencode.json")
    })
  })

  describe("#given OpenCode config uses only canonical plugin entries", () => {
    it("#then does not log a startup warning", async () => {
      //#given
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
        log: mockLog,
        migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
      })

      //#then
      expect(mockLog).not.toHaveBeenCalled()
      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })
  })

  describe("#given migration succeeds", () => {
    it("#then logs success message to console", async () => {
      //#given
      mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult({
        hasLegacyEntry: true,
        legacyEntries: ["oh-my-opencode@latest"],
        configPath: "/tmp/opencode.json",
      }))
      mockMigrateLegacyPluginEntry.mockReturnValue(true)
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning({
        checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
        log: mockLog,
        migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
      })

      //#then
      const calls = consoleWarnSpy.mock.calls.map((call: string[]) => call[0] ?? "")
      expect(calls.some((c) => c.includes("Auto-migrated"))).toBe(true)
    })
  })
})
