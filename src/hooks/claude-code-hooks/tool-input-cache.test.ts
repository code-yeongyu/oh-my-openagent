import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

describe("tool-input-cache", () => {
  const originalSetInterval = globalThis.setInterval
  const originalClearInterval = globalThis.clearInterval

  beforeEach(() => {
    globalThis.setInterval = originalSetInterval
    globalThis.clearInterval = originalClearInterval
  })

  afterEach(async () => {
    const modulePath = new URL("./tool-input-cache.ts", import.meta.url).pathname
    const cacheModule = await import(`${modulePath}?cleanup=${Date.now()}`)
    cacheModule.stopToolInputCacheCleanup()
  })

  test("#given cached entries from multiple sessions #when clearing one session #then only matching entries are removed", async () => {
    //#given
    const modulePath = new URL("./tool-input-cache.ts", import.meta.url).pathname
    const cacheModule = await import(`${modulePath}?session-clear`)

    cacheModule.cacheToolInput("ses_a", "Read", "call-1", { path: "a" })
    cacheModule.cacheToolInput("ses_b", "Read", "call-2", { path: "b" })

    //#when
    cacheModule.clearToolInputCache("ses_a")

    //#then
    expect(cacheModule.getToolInput("ses_a", "Read", "call-1")).toBeNull()
    expect(cacheModule.getToolInput("ses_b", "Read", "call-2")).toEqual({ path: "b" })
  })

  test("#given cleanup timer started #when stop cleanup runs #then interval is cleared and cache is emptied", async () => {
    //#given
    const intervalHandle = { unref: mock(() => {}) } as unknown as ReturnType<typeof setInterval>
    const setIntervalMock = mock(() => intervalHandle)
    const clearIntervalMock = mock(() => {})
    globalThis.setInterval = setIntervalMock as unknown as typeof setInterval
    globalThis.clearInterval = clearIntervalMock as unknown as typeof clearInterval

    const modulePath = new URL("./tool-input-cache.ts", import.meta.url).pathname
    const cacheModule = await import(`${modulePath}?stop-clear`)
    cacheModule.cacheToolInput("ses_stop", "Read", "call-stop", { path: "stop" })

    //#when
    cacheModule.stopToolInputCacheCleanup()

    //#then
    expect(setIntervalMock).toHaveBeenCalledTimes(1)
    expect(clearIntervalMock).toHaveBeenCalledWith(intervalHandle)
    expect(cacheModule.getToolInput("ses_stop", "Read", "call-stop")).toBeNull()
  })
})
