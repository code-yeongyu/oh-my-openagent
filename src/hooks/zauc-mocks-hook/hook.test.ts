import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

let scheduledDeferredCheck: (() => void) | null = null
mock.module("../auto-update-checker/hook/deferred-idle-check", () => ({
  scheduleDeferredIdleCheck: (runCheck: () => void) => {
    scheduledDeferredCheck = runCheck
  },
}))

const { createAutoUpdateCheckerHook } = await import("../auto-update-checker/hook")

const mockShowConfigErrorsIfAny = mock(async () => {})
const mockShowModelCacheWarningIfNeeded = mock(async () => {})
const mockUpdateAndShowConnectedProvidersCacheStatus = mock(async () => {})
const mockRefreshModelCapabilitiesOnStartup = mock(async () => {})
const mockShowLocalDevToast = mock(async () => {})
const mockShowVersionToast = mock(async () => {})
const mockRunBackgroundUpdateCheck = mock(async () => {})
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock<(directory: string) => string | null>(() => null)

function createPluginInput() {
  return {
    directory: "/test",
    client: {} as never,
  } as never
}

async function flushScheduledWork(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0)
  })
  await Promise.resolve()
  await Promise.resolve()
}

function runSessionCreatedEvent(
  hook: ReturnType<typeof createAutoUpdateCheckerHook>,
  properties?: { info?: { parentID?: string } }
): void {
  hook.event({
    event: {
      type: "session.created",
      properties,
    },
  })
}

function runSessionIdleEvent(hook: ReturnType<typeof createAutoUpdateCheckerHook>): void {
  hook.event({
    event: {
      type: "session.idle",
    },
  })
}

function drainDeferredCheck(): void {
  const run = scheduledDeferredCheck
  scheduledDeferredCheck = null
  run?.()
}

beforeEach(() => {
  mockShowConfigErrorsIfAny.mockClear()
  mockShowModelCacheWarningIfNeeded.mockClear()
  mockUpdateAndShowConnectedProvidersCacheStatus.mockClear()
  mockRefreshModelCapabilitiesOnStartup.mockClear()
  mockShowLocalDevToast.mockClear()
  mockShowVersionToast.mockClear()
  mockRunBackgroundUpdateCheck.mockClear()
  mockGetCachedVersion.mockClear()
  mockGetLocalDevVersion.mockClear()

  mockGetCachedVersion.mockReturnValue("3.6.0")
  mockGetLocalDevVersion.mockReturnValue(null)

  scheduledDeferredCheck = null
})

afterEach(() => {
  delete process.env.OPENCODE_CLI_RUN_MODE
})

describe("createAutoUpdateCheckerHook", () => {
  it("skips startup toasts and checks in CLI run mode", async () => {
    //#given - CLI run mode enabled
    process.env.OPENCODE_CLI_RUN_MODE = "true"

    const hook = createAutoUpdateCheckerHook(createPluginInput(), {
      showStartupToast: true,
      isSisyphusEnabled: true,
      autoUpdate: true,
    }, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created event arrives
    runSessionCreatedEvent(hook, { info: { parentID: undefined } })
    await flushScheduledWork()

    //#then - no update checker side effects run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
    expect(mockRefreshModelCapabilitiesOnStartup).not.toHaveBeenCalled()
    expect(mockShowLocalDevToast).not.toHaveBeenCalled()
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  it("runs all startup checks on normal session.created", async () => {
    //#given - normal mode and no local dev version
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {}, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created schedules work and session.idle drains it
    runSessionCreatedEvent(hook)
    runSessionIdleEvent(hook)
    drainDeferredCheck()
    await flushScheduledWork()

    //#then - startup checks, toast, and background check run
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mockRefreshModelCapabilitiesOnStartup).toHaveBeenCalledTimes(1)
    expect(mockShowModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).toHaveBeenCalledTimes(1)
    expect(mockRunBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it("ignores subagent sessions (parentID present)", async () => {
    //#given - a subagent session with parentID
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {}, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created event contains parentID
    runSessionCreatedEvent(hook, { info: { parentID: "parent-123" } })
    await flushScheduledWork()

    //#then - no startup actions run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
    expect(mockRefreshModelCapabilitiesOnStartup).not.toHaveBeenCalled()
    expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
    expect(mockShowLocalDevToast).not.toHaveBeenCalled()
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  it("runs only once (hasChecked guard)", async () => {
    //#given - one hook instance in normal mode
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {}, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created fires twice then session.idle fires twice
    runSessionCreatedEvent(hook)
    runSessionCreatedEvent(hook)
    runSessionIdleEvent(hook)
    runSessionIdleEvent(hook)
    drainDeferredCheck()
    await flushScheduledWork()

    //#then - side effects execute only once
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mockRefreshModelCapabilitiesOnStartup).toHaveBeenCalledTimes(1)
    expect(mockShowModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).toHaveBeenCalledTimes(1)
    expect(mockRunBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it("shows localDevToast when local dev version exists", async () => {
    //#given - local dev version is present
    mockGetLocalDevVersion.mockReturnValue("3.6.0-dev")
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {}, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created schedules and session.idle drains
    runSessionCreatedEvent(hook)
    runSessionIdleEvent(hook)
    drainDeferredCheck()
    await flushScheduledWork()

    //#then - local dev toast is shown and background check is skipped
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mockRefreshModelCapabilitiesOnStartup).toHaveBeenCalledTimes(1)
    expect(mockShowModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mockShowLocalDevToast).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  it("ignores non-session.created events", async () => {
    //#given - a hook instance in normal mode
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {}, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - a non-session.created event arrives
    hook.event({
      event: {
        type: "session.deleted",
      },
    })
    await flushScheduledWork()

    //#then - no startup actions run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
    expect(mockRefreshModelCapabilitiesOnStartup).not.toHaveBeenCalled()
    expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
    expect(mockShowLocalDevToast).not.toHaveBeenCalled()
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  it("passes correct toast message with sisyphus enabled", async () => {
    //#given - sisyphus mode enabled
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {
      isSisyphusEnabled: true,
    }, {
      getCachedVersion: mockGetCachedVersion,
      getLocalDevVersion: mockGetLocalDevVersion,
      showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
      showLocalDevToast: mockShowLocalDevToast,
      showVersionToast: mockShowVersionToast,
      runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
      log: () => {},
    })

    //#when - session.created schedules and session.idle drains
    runSessionCreatedEvent(hook)
    runSessionIdleEvent(hook)
    drainDeferredCheck()
    await flushScheduledWork()

    //#then - startup toast includes sisyphus wording
    expect(mockShowVersionToast).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "3.6.0",
      expect.stringContaining("Sisyphus")
    )
  })
})
