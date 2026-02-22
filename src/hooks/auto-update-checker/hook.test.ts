import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const mockShowConfigErrorsIfAny = mock(async () => {})
const mockShowModelCacheWarningIfNeeded = mock(async () => {})
const mockUpdateAndShowConnectedProvidersCacheStatus = mock(async () => {})
const mockShowLocalDevToast = mock(async () => {})
const mockShowVersionToast = mock(async () => {})
const mockRunBackgroundUpdateCheck = mock(async () => {})
const mockGetCachedVersion = mock(() => "3.6.0")
const mockGetLocalDevVersion = mock<(directory: string) => string | null>(() => null)

mock.module("./hook/config-errors-toast", () => ({
  showConfigErrorsIfAny: mockShowConfigErrorsIfAny,
}))

mock.module("./hook/model-cache-warning", () => ({
  showModelCacheWarningIfNeeded: mockShowModelCacheWarningIfNeeded,
}))

mock.module("./hook/connected-providers-status", () => ({
  updateAndShowConnectedProvidersCacheStatus:
    mockUpdateAndShowConnectedProvidersCacheStatus,
}))

mock.module("./hook/startup-toasts", () => ({
  showLocalDevToast: mockShowLocalDevToast,
  showVersionToast: mockShowVersionToast,
}))

mock.module("./hook/background-update-check", () => ({
  runBackgroundUpdateCheck: mockRunBackgroundUpdateCheck,
}))

mock.module("./checker", () => ({
  getCachedVersion: mockGetCachedVersion,
  getLocalDevVersion: mockGetLocalDevVersion,
}))

mock.module("../../shared/logger", () => ({
  log: () => {},
}))

type HookFactory = typeof import("./hook").createAutoUpdateCheckerHook

async function importFreshHookFactory(): Promise<HookFactory> {
  const hookModule = await import(`./hook?test-${Date.now()}-${Math.random()}`)
  return hookModule.createAutoUpdateCheckerHook
}

function createPluginInput() {
  return {
    directory: "/test",
    client: {} as never,
  } as never
}

beforeEach(() => {
  mockShowConfigErrorsIfAny.mockClear()
  mockShowModelCacheWarningIfNeeded.mockClear()
  mockUpdateAndShowConnectedProvidersCacheStatus.mockClear()
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
    hook.event({
      event: {
        type: "session.created",
        properties: { info: { parentID: undefined } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - no update checker side effects run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockShowModelCacheWarningIfNeeded).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
    expect(mockShowLocalDevToast).not.toHaveBeenCalled()
    expect(mockShowVersionToast).not.toHaveBeenCalled()
    expect(mockRunBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  it("runs all startup checks on normal session.created", async () => {
    //#given - normal mode and no local dev version
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    //#when - session.created event arrives on primary session
    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - startup checks, toast, and background check run
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mockShowModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).toHaveBeenCalledTimes(1)
    expect(mockRunBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  it("ignores subagent sessions (parentID present)", async () => {
    //#given - a subagent session with parentID
    const createAutoUpdateCheckerHook = await importFreshHookFactory()
    const hook = createAutoUpdateCheckerHook(createPluginInput())

    //#when - session.created event contains parentID
    hook.event({
      event: {
        type: "session.created",
        properties: { info: { parentID: "parent-123" } },
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - no startup actions run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
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
    hook.event({
      event: {
        type: "session.created",
      },
    })
    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - side effects execute only once
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
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
    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - local dev toast is shown and background check is skipped
    expect(mockShowConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
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
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - no startup actions run
    expect(mockShowConfigErrorsIfAny).not.toHaveBeenCalled()
    expect(mockUpdateAndShowConnectedProvidersCacheStatus).not.toHaveBeenCalled()
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
    hook.event({
      event: {
        type: "session.created",
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 50))

    //#then - startup toast includes sisyphus wording
    expect(mockShowVersionToast).toHaveBeenCalledTimes(1)
    expect(mockShowVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "3.6.0",
      expect.stringContaining("Sisyphus")
    )
  })
})
