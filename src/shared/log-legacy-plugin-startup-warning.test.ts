import { afterAll, afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test"
import type { LegacyPluginCheckResult } from "./legacy-plugin-warning"

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

mock.module("./legacy-plugin-warning", () => ({
  checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
}))

mock.module("./logger", () => ({
  log: mockLog,
}))

mock.module("./migrate-legacy-plugin-entry", () => ({
  migrateLegacyPluginEntry: mockMigrateLegacyPluginEntry,
}))

afterAll(() => {
  mock.restore()
})

async function importFreshStartupWarningModule(): Promise<typeof import("./log-legacy-plugin-startup-warning")> {
  return import(`./log-legacy-plugin-startup-warning?test=${Date.now()}-${Math.random()}`)
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
      logLegacyPluginStartupWarning()

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
      logLegacyPluginStartupWarning()

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
      logLegacyPluginStartupWarning()

      //#then
      expect(mockMigrateLegacyPluginEntry).toHaveBeenCalledWith("/tmp/opencode.json")
    })
  })

  describe("#given OpenCode config uses only canonical plugin entries", () => {
    it("#then does not log a startup warning", async () => {
      //#given
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning()

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
      logLegacyPluginStartupWarning()

      //#then
      const calls = consoleWarnSpy.mock.calls.map((c) => c[0] as string)
      expect(calls.some((c) => c.includes("Auto-migrated"))).toBe(true)
    })
  })
})
