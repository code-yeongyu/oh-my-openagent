import { afterEach, describe, expect, jest, test } from "bun:test"
import { setImmediate } from "node:timers/promises"

import { bounded } from "../lifecycle/__fixtures__/live-parent-clock"
import { readEvents } from "../lifecycle/__fixtures__/lifecycle-fakes"
import { baseSpec, cleanupProjects, FakeRunner, makeHandle, makeManager } from "./__fixtures__/manager-fakes"
import type { ManagedRunner } from "./types"

afterEach(cleanupProjects)

describe("shutdown teardown failure containment", () => {
  for (const failure of ["throw", "reject"] as const) {
    test(`#given a runner whose teardown ${failure}s with a launch in flight #when shutdown reaches its bound #then shutdown resolves and parks the launch`, async () => {
      // given: a real circuit breaker is armed before freezing the production deadline.
      const entered = Promise.withResolvers<string>()
      const teardown = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      let disposed = false
      const runner: ManagedRunner = {
        start: (spec) => {
          const child = makeHandle(spec.taskId)
          entered.resolve(spec.taskId)
          return release.promise.then(() => ({
            ...child.handle,
            dispose: async () => { disposed = true },
          }))
        },
        settleTeardowns: () => {
          teardown.resolve()
          const error = new Error(`synthetic teardown ${failure}`)
          if (failure === "throw") throw error
          return Promise.reject(error)
        },
      }
      const { manager, store } = makeManager({ process: runner, inProcess: new FakeRunner() })
      const starting = manager.start(baseSpec({ execution_mode: "process" }))
      const taskId = await bounded(entered.promise)
      const watchdog = Promise.withResolvers<never>()
      const timer = setTimeout(() => watchdog.reject(new Error("shutdown did not contain teardown failure")), 2_000)
      const shutdownBoundMs = 5_000
      jest.useFakeTimers()
      try {
        // when: teardown fails while admission stays held; only virtual time expires the bound.
        const shutdown = manager.settleLaunchesForShutdown?.(shutdownBoundMs) ?? Promise.resolve()
        const outcome = shutdown.then(() => "resolved", (error: unknown) => error)
        await Promise.race([teardown.promise, watchdog.promise])
        // A check-phase event drains the failure's promise jobs before the virtual deadline fires.
        await Promise.race([setImmediate(), watchdog.promise])
        jest.advanceTimersByTime(shutdownBoundMs)

        // then: neither a synchronous throw nor an asynchronous rejection may skip parking.
        expect(await Promise.race([outcome, watchdog.promise])).toBe("resolved")
        const parked = store.load(taskId)
        expect(parked?.status).toBe("running")
        expect(parked?.residency_state).toBe("persisted_only")
        expect(parked?.host_pid).toBeUndefined()
        expect(parked?.started_at).toBeUndefined()
        expect(readEvents(store, taskId)).toContain("suspended")
      } finally {
        jest.useRealTimers()
        clearTimeout(timer)
        release.resolve()
        await bounded(starting)
        await bounded(manager.whenLaunched?.(taskId) ?? Promise.resolve())
      }
      expect(manager.residentTaskIds()).not.toContain(taskId)
      expect(disposed).toBe(true)
    })
  }
})
