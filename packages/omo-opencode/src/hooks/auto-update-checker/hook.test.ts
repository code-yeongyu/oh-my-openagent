import type { PluginInput } from "@opencode-ai/plugin"
import { afterAll, describe, expect, mock, test } from "bun:test"
import { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile } from "../../testing/module-mock-lifecycle"

type CreateAutoUpdateCheckerHook = typeof import("./hook").createAutoUpdateCheckerHook
type HookOptions = Parameters<CreateAutoUpdateCheckerHook>[1]
type HookDeps = NonNullable<Parameters<CreateAutoUpdateCheckerHook>[2]>

let latestVersionCallCount = 0
let scheduleDeferredStartupCheckCallCount = 0

const flushMicrotasks = async (count: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
  }
}

const latestVersionMock = async () => {
  latestVersionCallCount += 1
  return "3.0.1"
}

const scheduleDeferredStartupCheckMock = (runCheck: () => void) => {
  scheduleDeferredStartupCheckCallCount += 1
  scheduledCheck = runCheck
}

let scheduledCheck: (() => void) | null = null

mock.module("./checker/latest-version", () => ({
  getLatestVersion: latestVersionMock,
}))

mock.module("./hook/deferred-startup-check", () => ({
  scheduleDeferredStartupCheck: scheduleDeferredStartupCheckMock,
}))
preserveModuleMocksForTestFile(import.meta.url)

afterAll(() => {
  restoreModuleMocksForTestFile(import.meta.url)
})

const createPluginInput = (): PluginInput => ({
  client: {} as PluginInput["client"],
  directory: "/tmp/project",
  project: {} as PluginInput["project"],
  worktree: "/tmp/project",
  serverUrl: new URL("https://example.com"),
  $: {} as PluginInput["$"],
} satisfies PluginInput)

const createDeps = (overrides: Partial<HookDeps> = {}) => {
  const showConfigErrorsIfAny = mock(async () => undefined)
  const updateAndShowConnectedProvidersCacheStatus = mock(async () => undefined)
  const refreshModelCapabilitiesOnStartup = mock(async () => undefined)
  const showModelCacheWarningIfNeeded = mock(async () => undefined)
  const showLocalDevToast = mock(async () => undefined)
  const showVersionToast = mock(async () => undefined)
  const runBackgroundUpdateCheck = mock(async () => {
    await latestVersionMock()
  })

  const deps: HookDeps = {
    getBundledVersion: () => "3.0.0",
    getCachedVersion: () => "3.0.0",
    getLocalDevVersion: () => null,
    showConfigErrorsIfAny,
    updateAndShowConnectedProvidersCacheStatus,
    refreshModelCapabilitiesOnStartup,
    showModelCacheWarningIfNeeded,
    showLocalDevToast,
    showVersionToast,
    runBackgroundUpdateCheck,
    log: () => undefined,
    ...overrides,
  }

  return {
    deps,
    mocks: {
      showConfigErrorsIfAny,
      updateAndShowConnectedProvidersCacheStatus,
      refreshModelCapabilitiesOnStartup,
      showModelCacheWarningIfNeeded,
      showLocalDevToast,
      showVersionToast,
      runBackgroundUpdateCheck,
    },
  }
}

const createHook = async (
  options: HookOptions = {},
  overrides: Partial<HookDeps> = {},
) => {
  const module = await import("./hook")
  const { deps, mocks } = createDeps(overrides)

  return {
    hook: module.createAutoUpdateCheckerHook(
      createPluginInput(),
      {
        showStartupToast: true,
        autoUpdate: false,
        ...options,
      },
      deps,
    ),
    mocks,
  }
}

const resetDeferredState = (): void => {
  latestVersionCallCount = 0
  scheduleDeferredStartupCheckCallCount = 0
  scheduledCheck = null
}

const runScheduledCheck = async (): Promise<void> => {
  scheduledCheck?.()
  await flushMicrotasks(8)
}

const triggerSessionCreated = (
  hook: ReturnType<CreateAutoUpdateCheckerHook>,
  properties?: { info?: { parentID?: string } },
): void => {
  hook.event({ event: { type: "session.created", properties } })
}

const triggerSessionIdle = (hook: ReturnType<CreateAutoUpdateCheckerHook>): void => {
  hook.event({ event: { type: "session.idle" } })
}

describe("auto-update-checker hook", () => {
  test("schedules deferred check on session.created without parentID", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    triggerSessionCreated(hook)

    // then
    expect(scheduleDeferredStartupCheckCallCount).toBe(1)
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
    expect(mocks.runBackgroundUpdateCheck).not.toHaveBeenCalled()
    expect(latestVersionCallCount).toBe(0)

    // when
    await runScheduledCheck()

    // then
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
    expect(latestVersionCallCount).toBe(1)
  })

  test("does not schedule deferred check on session.created with parentID", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    triggerSessionCreated(hook, { info: { parentID: "parent-123" } })

    // then
    expect(scheduleDeferredStartupCheckCallCount).toBe(0)
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
    expect(mocks.runBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  test("does not schedule deferred check on session.idle without session.created", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    triggerSessionIdle(hook)

    // then
    expect(scheduleDeferredStartupCheckCallCount).toBe(0)
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
    expect(mocks.runBackgroundUpdateCheck).not.toHaveBeenCalled()
  })

  test("runs all startup checks after deferred session.created check executes", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then
    expect(mocks.showConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mocks.updateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mocks.refreshModelCapabilitiesOnStartup).toHaveBeenCalledTimes(1)
    expect(mocks.showModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  test("guards double execution across repeated session.created events", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    triggerSessionCreated(hook)
    triggerSessionCreated(hook)

    // then
    expect(scheduleDeferredStartupCheckCallCount).toBe(1)

    // when
    await runScheduledCheck()
    triggerSessionCreated(hook)

    // then
    expect(scheduleDeferredStartupCheckCallCount).toBe(1)
    expect(mocks.showConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mocks.updateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mocks.showModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  test("shows localDevToast when local dev version exists", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook({}, {
      getLocalDevVersion: () => "3.0.0-dev",
    })

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then
    expect(mocks.showConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mocks.updateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mocks.showModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mocks.showLocalDevToast).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
    expect(mocks.runBackgroundUpdateCheck).not.toHaveBeenCalled()
    expect(latestVersionCallCount).toBe(0)
  })

  test("passes correct toast message with sisyphus enabled", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook({ isSisyphusEnabled: true })

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "3.0.0",
      expect.stringContaining("Sisyphus"),
    )
  })

  // regression: issue #4211 - banner must show bundled (build-time) version, not the
  // potentially stale package.json sitting in OpenCode's plugin cache.
  test("banner shows bundled build-time version even when cached install drifts", async () => {
    // given: cached install reports an old version (simulating a stale plugin cache),
    //         bundled (build-time) reports the actually-loaded build's version
    resetDeferredState()
    const { hook, mocks } = await createHook({}, {
      getCachedVersion: () => "4.0.0",
      getBundledVersion: () => "4.3.0",
      getLocalDevVersion: () => null,
    })

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then: banner displays the bundled version, never the stale cached one
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "4.3.0",
      expect.any(String),
    )
  })

  test("local dev version still wins over bundled version on the banner", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook({}, {
      getBundledVersion: () => "4.3.0",
      getLocalDevVersion: () => "5.0.0-dev",
    })

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then: localDev takes precedence so contributors see their working build
    expect(mocks.showLocalDevToast).toHaveBeenCalledTimes(1)
    expect(mocks.showLocalDevToast).toHaveBeenCalledWith(
      expect.anything(),
      "5.0.0-dev",
      expect.any(Boolean),
    )
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
  })

  test("banner falls back to cached version when the bundled version dep is absent", async () => {
    // given: an injected-deps caller predating getBundledVersion keeps the legacy banner
    resetDeferredState()
    const { hook, mocks } = await createHook({}, {
      getBundledVersion: undefined,
      getCachedVersion: () => "3.9.9",
      getLocalDevVersion: () => null,
    })

    // when
    triggerSessionCreated(hook)
    await runScheduledCheck()

    // then: the cached-version banner still renders instead of crashing the deferred check
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "3.9.9",
      expect.any(String),
    )
  })
})
