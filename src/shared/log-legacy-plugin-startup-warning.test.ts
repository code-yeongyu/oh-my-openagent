import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { LegacyPluginCheckResult } from "./legacy-plugin-warning"

function createLegacyPluginCheckResult(
  overrides: Partial<LegacyPluginCheckResult> = {},
): LegacyPluginCheckResult {
  return {
    hasLegacyEntry: false,
    hasCanonicalEntry: false,
    legacyEntries: [],
    ...overrides,
  }
}

const mockCheckForLegacyPluginEntry = mock(() => createLegacyPluginCheckResult())

const mockLog = mock(() => {})

mock.module("./legacy-plugin-warning", () => ({
  checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
}))

mock.module("./logger", () => ({
  log: mockLog,
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

    mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult())
  })

  describe("#given OpenCode config contains legacy plugin entries", () => {
    it("logs the legacy entries with canonical replacements", async () => {
      //#given
      mockCheckForLegacyPluginEntry.mockReturnValue(createLegacyPluginCheckResult({
        hasLegacyEntry: true,
        legacyEntries: ["oh-my-opencode", "oh-my-opencode@3.13.1"],
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
  })

  describe("#given OpenCode config uses only canonical plugin entries", () => {
    it("does not log a startup warning", async () => {
      //#given
      const { logLegacyPluginStartupWarning } = await importFreshStartupWarningModule()

      //#when
      logLegacyPluginStartupWarning()

      //#then
      expect(mockLog).not.toHaveBeenCalled()
    })
  })
})
