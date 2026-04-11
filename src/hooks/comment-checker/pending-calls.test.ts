import { describe, test, expect } from "bun:test"

describe("pending-calls cleanup interval", () => {
  test("starts cleanup once and unrefs timer", async () => {
    //#given
    const originalSetInterval = globalThis.setInterval
    const setIntervalCalls: number[] = []
    let unrefCalled = 0

    globalThis.setInterval = ((
      _handler: TimerHandler,
      timeout?: number,
      ..._args: any[]
    ) => {
      setIntervalCalls.push(timeout as number)
      return {
        unref: () => {
          unrefCalled += 1
        },
      } as unknown as ReturnType<typeof setInterval>
    }) as unknown as typeof setInterval

    try {
      const modulePath = new URL("./pending-calls.ts", import.meta.url).pathname
      const pendingCallsModule = await import(`${modulePath}?pending-calls-test-once`)

      //#when
      pendingCallsModule.startPendingCallCleanup()
      pendingCallsModule.startPendingCallCleanup()

      //#then
      expect(setIntervalCalls).toEqual([10_000])
      expect(unrefCalled).toBe(1)
    } finally {
      globalThis.setInterval = originalSetInterval
    }
  })

  test("#given cleanup timer already started #when stop cleanup runs #then interval state resets for future reuse", async () => {
    //#given
    const originalSetInterval = globalThis.setInterval
    const originalClearInterval = globalThis.clearInterval
    let intervalHandle: ReturnType<typeof setInterval> | undefined
    let clearCalls = 0

    globalThis.setInterval = ((
      _handler: TimerHandler,
      _timeout?: number,
      ..._args: any[]
    ) => {
      intervalHandle = { unref: () => {} } as unknown as ReturnType<typeof setInterval>
      return intervalHandle
    }) as unknown as typeof setInterval

    globalThis.clearInterval = ((handle?: ReturnType<typeof setInterval>) => {
      if (handle === intervalHandle) {
        clearCalls += 1
      }
    }) as unknown as typeof clearInterval

    try {
      const modulePath = new URL("./pending-calls.ts", import.meta.url).pathname
      const pendingCallsModule = await import(`${modulePath}?pending-calls-test-stop`)
      pendingCallsModule.startPendingCallCleanup()

      //#when
      pendingCallsModule.stopPendingCallCleanup()
      pendingCallsModule.startPendingCallCleanup()

      //#then
      expect(clearCalls).toBe(1)
    } finally {
      globalThis.setInterval = originalSetInterval
      globalThis.clearInterval = originalClearInterval
    }
  })
})
