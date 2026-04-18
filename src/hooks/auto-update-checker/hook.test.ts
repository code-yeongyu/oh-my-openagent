import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, mock, test } from "bun:test"

type CreateAutoUpdateCheckerHook = typeof import("./hook").createAutoUpdateCheckerHook
type HookOptions = Parameters<CreateAutoUpdateCheckerHook>[1]
type HookDeps = NonNullable<Parameters<CreateAutoUpdateCheckerHook>[2]>

let latestVersionCallCount = 0
let scheduleDeferredIdleCheckCallCount = 0

const flushMicrotasks = async (count: number): Promise<void> => {
  for (let index = 0; index < count; index += 1) {
    await Promise.resolve()
  }
}

const latestVersionMock = async () => {
  latestVersionCallCount += 1
  return "3.0.1"
}

const scheduleDeferredIdleCheckMock = (runCheck: () => void) => {
  scheduleDeferredIdleCheckCallCount += 1
  scheduledCheck = runCheck
}

let scheduledCheck: (() => void) | null = null

mock.module("./checker/latest-version", () => ({
  getLatestVersion: latestVersionMock,
}))

mock.module("./hook/deferred-idle-check", () => ({
  scheduleDeferredIdleCheck: scheduleDeferredIdleCheckMock,
}))

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
  scheduleDeferredIdleCheckCallCount = 0
  scheduledCheck = null
}

const triggerDeferredIdleCheck = async (
  hook: ReturnType<CreateAutoUpdateCheckerHook>,
): Promise<void> => {
  hook.event({ event: { type: "session.idle" } })
  scheduledCheck?.()
  await flushMicrotasks(8)
}

describe("auto-update-checker hook", () => {
  test("defers update check until first session idle", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    hook.event({ event: { type: "session.created" } })

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(0)
    expect(mocks.showVersionToast).not.toHaveBeenCalled()
    expect(mocks.runBackgroundUpdateCheck).not.toHaveBeenCalled()
    expect(latestVersionCallCount).toBe(0)

    // when
    await triggerDeferredIdleCheck(hook)

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(1)
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
    expect(latestVersionCallCount).toBe(1)

    // when
    hook.event({ event: { type: "session.idle" } })

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  test("runs all startup checks on normal session.idle", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    await triggerDeferredIdleCheck(hook)

    // then
    expect(mocks.showConfigErrorsIfAny).toHaveBeenCalledTimes(1)
    expect(mocks.updateAndShowConnectedProvidersCacheStatus).toHaveBeenCalledTimes(1)
    expect(mocks.refreshModelCapabilitiesOnStartup).toHaveBeenCalledTimes(1)
    expect(mocks.showModelCacheWarningIfNeeded).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.runBackgroundUpdateCheck).toHaveBeenCalledTimes(1)
  })

  test("runs only once (hasChecked guard)", async () => {
    // given
    resetDeferredState()
    const { hook, mocks } = await createHook()

    // when
    hook.event({ event: { type: "session.idle" } })
    hook.event({ event: { type: "session.idle" } })
    scheduledCheck?.()
    await flushMicrotasks(8)

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(1)
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
    await triggerDeferredIdleCheck(hook)

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
    await triggerDeferredIdleCheck(hook)

    // then
    expect(mocks.showVersionToast).toHaveBeenCalledTimes(1)
    expect(mocks.showVersionToast).toHaveBeenCalledWith(
      expect.anything(),
      "3.0.0",
      expect.stringContaining("Sisyphus"),
    )
  })
})
