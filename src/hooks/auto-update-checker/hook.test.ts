import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, mock, test } from "bun:test"

const latestVersionMock = mock.fn(async () => "3.0.1")
const scheduleDeferredIdleCheckMock = mock.fn((runCheck: () => void) => {
  scheduledCheck = runCheck
})

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
    latestVersionMock.mockClear()
    scheduleDeferredIdleCheckMock.mockClear()
    scheduledCheck = null
    const hook = await createHook()

    // when
    hook.event({ event: { type: "session.created" } })

    // then
    expect(scheduleDeferredIdleCheckMock).toHaveBeenCalledTimes(0)
    expect(latestVersionMock).toHaveBeenCalledTimes(0)

    // when
    hook.event({ event: { type: "session.idle" } })

    // then
    expect(scheduleDeferredIdleCheckMock).toHaveBeenCalledTimes(1)
    expect(latestVersionMock).toHaveBeenCalledTimes(0)

    // when
    scheduledCheck?.()

    // then
    expect(latestVersionMock).toHaveBeenCalledTimes(1)

    // when
    hook.event({ event: { type: "session.idle" } })
    scheduledCheck?.()

    // then
    expect(scheduleDeferredIdleCheckMock).toHaveBeenCalledTimes(1)
    expect(latestVersionMock).toHaveBeenCalledTimes(1)
  })
})
