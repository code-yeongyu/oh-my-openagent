import { describe, expect, mock, spyOn, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { _resetPruneThrottleForTesting, BackgroundManager } from "./manager"

function createManagerWithStatus(statusImpl: () => Promise<{ data: Record<string, { type: string }> }>): BackgroundManager {
  const client = {
    session: {
      status: statusImpl,
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: [] }),
    },
  }

  return new BackgroundManager({ client, directory: tmpdir() } as unknown as PluginInput)
}

describe("BackgroundManager polling overlap", () => {
  test("skips overlapping pollRunningTasks executions", async () => {
    //#given
    let activeCalls = 0
    let maxActiveCalls = 0
    let statusCallCount = 0
    let releaseStatus: (() => void) | undefined
    const statusGate = new Promise<void>((resolve) => {
      releaseStatus = resolve
    })

    const manager = createManagerWithStatus(async () => {
      statusCallCount += 1
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      await statusGate
      activeCalls -= 1
      return { data: {} }
    })

    //#when
    const firstPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    await Promise.resolve()
    const secondPoll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    releaseStatus?.()
    await Promise.all([firstPoll, secondPoll])
    manager.shutdown()

    //#then
    expect(maxActiveCalls).toBe(1)
    expect(statusCallCount).toBe(1)
  })

  test("checkAndInterruptStaleTasks called once per poll", async () => {
    //#given
    const manager = createManagerWithStatus(async () => ({ data: {} }))

    const spy = mock(async (_statuses: unknown) => {})
    ;(manager as unknown as { checkAndInterruptStaleTasks: (s: unknown) => Promise<void> }).checkAndInterruptStaleTasks =
      spy
    ;(manager as unknown as { pruneStaleTasksAndNotifications: () => void }).pruneStaleTasksAndNotifications = () => {}

    //#when
    await (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()

    //#then
    expect(spy.mock.calls.length).toBe(1)

    manager.shutdown()
  })

  test("pollingInFlight atomic under concurrent ticks", async () => {
    //#given
    // Race-condition regression test: 10 concurrent pollRunningTasks() invocations
    // must result in exactly ONE body execution. The atomic check-and-set at
    // manager.ts:1639-1640 is synchronous (no `await` between check and set),
    // so the first call wins the pollingInFlight flag synchronously. The other
    // 9 see it as true in their sync prologue and return early at line 1639.
    // We spy on pruneStaleTasksAndNotifications (first call inside the try
    // block at line 1642) to count body executions. If a future refactor moved
    // `pollingInFlight = true` into the try block, or removed the finally
    // reset, this test would observe > 1 call.
    const manager = createManagerWithStatus(async () => ({ data: {} }))

    const pruneSpy = spyOn(
      manager as unknown as { pruneStaleTasksAndNotifications: () => void },
      "pruneStaleTasksAndNotifications"
    )
    pruneSpy.mockImplementation(() => {})

    //#when
    const concurrentCalls = Array.from({ length: 10 }, () =>
      (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks()
    )
    await Promise.all(concurrentCalls)

    //#then
    expect(pruneSpy.mock.calls.length).toBe(1)

    pruneSpy.mockRestore()
    manager.shutdown()
  })

  test("pruneStaleTasksAndNotifications throttled to 30s", async () => {
    //#given
    // Throttle test: pollRunningTasks() fires every 3s (POLLING_INTERVAL_MS),
    // but pruneStaleTasksAndNotifications only needs to run every 30s — stale
    // tasks age out at TASK_TTL_MS (30 minutes), so 30s is 60× the minimum
    // useful frequency. Throttle lives INSIDE pollRunningTasks (not in prune
    // itself) so the function stays pure. We make 10 SEQUENTIAL awaited calls
    // so each one enters the body — the B5 test uses concurrent calls which
    // are blocked by the pollingInFlight guard. The first call updates
    // lastPruneAt; the 9 subsequent calls see the throttle active and skip.
    _resetPruneThrottleForTesting()
    const manager = createManagerWithStatus(async () => ({ data: {} }))

    const pruneSpy = spyOn(
      manager as unknown as { pruneStaleTasksAndNotifications: () => void },
      "pruneStaleTasksAndNotifications"
    )
    pruneSpy.mockImplementation(() => {})

    const poll = (manager as unknown as { pollRunningTasks: () => Promise<void> }).pollRunningTasks.bind(manager)

    //#when
    for (let i = 0; i < 10; i++) {
      await poll()
    }

    //#then
    expect(pruneSpy.mock.calls.length).toBe(1)

    pruneSpy.mockRestore()
    manager.shutdown()
  })
})
