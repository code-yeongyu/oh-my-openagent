import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const mockShowConfigErrorsIfAny = mock(async () => {})
const mockShowModelCacheWarningIfNeeded = mock(async () => {})
const mockUpdateAndShowConnectedProvidersCacheStatus = mock(async () => {})
const mockRefreshModelCapabilitiesOnStartup = mock(async () => {})
const mockShowLocalDevToast = mock(async () => {})
const mockShowVersionToast = mock(async () => {})
const mockRunBackgroundUpdateCheck = mock(async () => {})
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock<(directory: string) => string | null>(() => null)

const _realConfigErrorsToast = require("../auto-update-checker/hook/config-errors-toast")
const _realModelCacheWarning = require("../auto-update-checker/hook/model-cache-warning")
const _realConnectedProvidersStatus = require("../auto-update-checker/hook/connected-providers-status")
const _realModelCapabilitiesStatus = require("../auto-update-checker/hook/model-capabilities-status")
const _realStartupToasts = require("../auto-update-checker/hook/startup-toasts")
const _realBackgroundUpdateCheck = require("../auto-update-checker/hook/background-update-check")
const _realChecker = require("../auto-update-checker/checker")
const _realLogger = require("../../shared/logger")

afterAll(() => {
  mock.module("../auto-update-checker/hook/config-errors-toast", () => _realConfigErrorsToast)
  mock.module("../auto-update-checker/hook/model-cache-warning", () => _realModelCacheWarning)
  mock.module("../auto-update-checker/hook/connected-providers-status", () => _realConnectedProvidersStatus)
  mock.module("../auto-update-checker/hook/model-capabilities-status", () => _realModelCapabilitiesStatus)
  mock.module("../auto-update-checker/hook/startup-toasts", () => _realStartupToasts)
  mock.module("../auto-update-checker/hook/background-update-check", () => _realBackgroundUpdateCheck)
  mock.module("../auto-update-checker/checker", () => _realChecker)
  mock.module("../../shared/logger", () => _realLogger)
  mock.restore()
})

type HookFactory = typeof import("../auto-update-checker/hook").createAutoUpdateCheckerHook

async function importFreshHookFactory(): Promise<HookFactory> {
  mock.module("../auto-update-checker/hook/config-errors-toast", () => ({
    showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
  }))
  mock.module("../auto-update-checker/hook/model-cache-warning", () => ({
    showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
  }))
  mock.module("../auto-update-checker/hook/connected-providers-status", () => ({
    updateAndShowConnectedProvidersCacheStatus: mockUpdateAndShowConnectedProvidersCacheStatus,
  }))
  mock.module("../auto-update-checker/hook/model-capabilities-status", () => ({
    refreshModelCapabilitiesOnStartup: mockRefreshModelCapabilitiesOnStartup,
  }))
  mock.module("../auto-update-checker/hook/startup-toasts", () => ({
    showLocalDevToast: mockShowLocalDevToast,
    showVersionToast: mockShowVersionToast,
  }))
  mock.module("../auto-update-checker/hook/background-update-check", () => ({
    runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
  }))
  mock.module("../auto-update-checker/checker", () => ({
    getCachedVersion: mockGetCachedVersion,
    getLocalDevVersion: mockGetLocalDevVersion,
  }))
  mock.module("../../shared/logger", () => ({
    log: () => {},
  }))
  const hookModule = await import(`../auto-update-checker/hook?test-${Date.now()}-${Math.random()}`)
  return hookModule.createAutoUpdateCheckerHook
}

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
  hook: ReturnType<HookFactory>,
  properties?: { info?: { parentID?: string } }
): void {
  hook.event({
    event: {
      type: "session.created",
      properties,
    },
  })
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
})

afterEach(() => {
  delete process.env.OPENCODE_CLI_RUN_MODE
})

describe("createAutoUpdateCheckerHook", () => {
  it("skips startup toasts and checks in CLI run mode", async () => {
    //#given - CLI run mode enabled
    process.env.OPENCODE_CLI_RUN_MODE = "true"
    const createAutoUpdateCheckerHook = await importFreshHookFactory()

    const hook = createAutoUpdateCheckerHook(createPluginInput(), {
      showStartupToast: true,
      isSisyphusEnabled: true,
      autoUpdate: true,
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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    //#when - session.created event arrives on primary session
    runSessionCreatedEvent(hook)
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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    //#when - session.created event is fired twice
    runSessionCreatedEvent(hook)
    runSessionCreatedEvent(hook)
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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    //#when - session.created event arrives
    runSessionCreatedEvent(hook)
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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

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
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput(), {
      isSisyphusEnabled: true,
    })

    //#when - session.created event arrives
    runSessionCreatedEvent(hook)
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
