import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test"
import type { MigrationResult } from "./auto-migrate"

const mockCheckForLegacyPluginEntry = mock(() => ({
  hasLegacyEntry: false,
  hasCanonicalEntry: false,
  legacyEntries: [] as string[],
}))

const mockAutoMigrate = mock((): MigrationResult => ({
  migrated: false,
  from: null,
  to: null,
  configPath: null,
}))

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockShowToast = mock((_arg: any) => Promise.resolve())
const mockLog = mock(() => {})

mock.module("../../shared/legacy-plugin-warning", () => ({
  checkForLegacyPluginEntry: mockCheckForLegacyPluginEntry,
}))

mock.module("../../shared/logger", () => ({
  log: mockLog,
}))

mock.module("./auto-migrate", () => ({
  autoMigrateLegacyPluginEntry: mockAutoMigrate,
}))

afterAll(() => {
  mock.restore()
})

function createMockCtx() {
  return {
    client: {
      tui: { showToast: mockShowToast },
    },
    directory: "/tmp/test",
  } as never
}

function createEvent(type: string, parentID?: string) {
  return {
    event: {
      type,
      properties: parentID ? { info: { parentID } } : { info: {} },
    },
  }
}

async function importFreshModule() {
  return import(`./hook?t=${Date.now()}-${Math.random()}`)
}

describe("createLegacyPluginToastHook", () => {
  beforeEach(() => {
    mockCheckForLegacyPluginEntry.mockReset()
    mockAutoMigrate.mockReset()
    mockShowToast.mockReset()
    mockLog.mockReset()

    mockCheckForLegacyPluginEntry.mockReturnValue({
      hasLegacyEntry: false,
      hasCanonicalEntry: true,
      legacyEntries: [],
    })
    mockAutoMigrate.mockReturnValue({ migrated: false, from: null, to: null, configPath: null })
    mockShowToast.mockResolvedValue(undefined)
  })

  describe("#given no legacy entry exists", () => {
    it("#then does not show a toast", async () => {
      // given
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.created"))

      // then
      expect(mockShowToast).not.toHaveBeenCalled()
    })
  })

  describe("#given legacy entry exists and migration succeeds", () => {
    it("#then shows success toast", async () => {
      // given
      mockCheckForLegacyPluginEntry.mockReturnValue({
        hasLegacyEntry: true,
        hasCanonicalEntry: false,
        legacyEntries: ["oh-my-opencode"],
      })
      mockAutoMigrate.mockReturnValue({
        migrated: true,
        from: "oh-my-opencode",
        to: "oh-my-openagent",
        configPath: "/tmp/opencode.json",
      })
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.created"))

      // then
      expect(mockShowToast).toHaveBeenCalledTimes(1)
      const toastArg = mockShowToast.mock.calls[0][0] as { body: { variant: string } }
      expect(toastArg.body.variant).toBe("success")
    })
  })

  describe("#given legacy entry exists but migration fails", () => {
    it("#then shows warning toast", async () => {
      // given
      mockCheckForLegacyPluginEntry.mockReturnValue({
        hasLegacyEntry: true,
        hasCanonicalEntry: false,
        legacyEntries: ["oh-my-opencode"],
      })
      mockAutoMigrate.mockReturnValue({
        migrated: false,
        from: null,
        to: null,
        configPath: "/tmp/opencode.json",
      })
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.created"))

      // then
      expect(mockShowToast).toHaveBeenCalledTimes(1)
      const toastArg2 = mockShowToast.mock.calls[0][0] as { body: { variant: string } }
      expect(toastArg2.body.variant).toBe("warning")
    })
  })

  describe("#given session.created fires twice", () => {
    it("#then only fires once (once-guard)", async () => {
      // given
      mockCheckForLegacyPluginEntry.mockReturnValue({
        hasLegacyEntry: true,
        hasCanonicalEntry: false,
        legacyEntries: ["oh-my-opencode"],
      })
      mockAutoMigrate.mockReturnValue({
        migrated: true,
        from: "oh-my-opencode",
        to: "oh-my-openagent",
        configPath: "/tmp/opencode.json",
      })
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.created"))
      await hook.event(createEvent("session.created"))

      // then
      expect(mockShowToast).toHaveBeenCalledTimes(1)
    })
  })

  describe("#given a non-session.created event fires", () => {
    it("#then does nothing", async () => {
      // given
      mockCheckForLegacyPluginEntry.mockReturnValue({
        hasLegacyEntry: true,
        hasCanonicalEntry: false,
        legacyEntries: ["oh-my-opencode"],
      })
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.deleted"))

      // then
      expect(mockCheckForLegacyPluginEntry).not.toHaveBeenCalled()
    })
  })

  describe("#given session.created from a subagent (has parentID)", () => {
    it("#then skips the check", async () => {
      // given
      mockCheckForLegacyPluginEntry.mockReturnValue({
        hasLegacyEntry: true,
        hasCanonicalEntry: false,
        legacyEntries: ["oh-my-opencode"],
      })
      const { createLegacyPluginToastHook } = await importFreshModule()
      const hook = createLegacyPluginToastHook(createMockCtx())

      // when
      await hook.event(createEvent("session.created", "parent-session-id"))

      // then
      expect(mockCheckForLegacyPluginEntry).not.toHaveBeenCalled()
    })
  })
})
