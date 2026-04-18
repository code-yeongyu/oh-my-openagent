import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, mock, test } from "bun:test"

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

const createHook = async () => {
  const module = await import("./hook")
  return module.createAutoUpdateCheckerHook(
    {
      directory: "/tmp/project",
      client: {
        tui: {
          showToast: async () => undefined,
        },
      },
    } satisfies PluginInput,
    {
      showStartupToast: false,
      autoUpdate: false,
    },
    {
      getCachedVersion: () => "3.0.0",
      getLocalDevVersion: () => null,
      showConfigErrorsIfAny: async () => undefined,
      updateAndShowConnectedProvidersCacheStatus: async () => undefined,
      refreshModelCapabilitiesOnStartup: async () => undefined,
      showModelCacheWarningIfNeeded: async () => undefined,
      showLocalDevToast: async () => undefined,
      showVersionToast: async () => undefined,
      runBackgroundUpdateCheck: async () => {
        await latestVersionMock()
      },
      log: () => undefined,
    },
  )
}

describe("auto-update-checker hook", () => {
  test("defers update check until first session idle", async () => {
    // given
    latestVersionCallCount = 0
    scheduleDeferredIdleCheckCallCount = 0
    scheduledCheck = null
    const hook = await createHook()

    // when
    hook.event({ event: { type: "session.created" } })

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(0)
    expect(latestVersionCallCount).toBe(0)

    // when
    hook.event({ event: { type: "session.idle" } })

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(1)
    expect(latestVersionCallCount).toBe(0)

    // when
    await scheduledCheck?.()
    await flushMicrotasks(8)

    // then
    expect(latestVersionCallCount).toBe(1)

    // when
    hook.event({ event: { type: "session.idle" } })

    // then
    expect(scheduleDeferredIdleCheckCallCount).toBe(1)
    expect(latestVersionCallCount).toBe(1)
  })
})
