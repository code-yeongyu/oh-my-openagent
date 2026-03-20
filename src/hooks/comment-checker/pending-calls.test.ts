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
})
