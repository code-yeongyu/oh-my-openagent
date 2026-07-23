import { describe, expect, it } from "bun:test"

import { IdleInjectionCoordinator } from "./idle-injection-coordinator"

interface DeliveredCall {
  content: string
  options: { deliverAs: "steer" | "followUp" }
}

function createCoordinator(): { coordinator: IdleInjectionCoordinator; calls: DeliveredCall[] } {
  const calls: DeliveredCall[] = []
  const coordinator = new IdleInjectionCoordinator((content, options) => calls.push({ content, options }))
  return { coordinator, calls }
}

describe("IdleInjectionCoordinator", () => {
  it("#given a completion and a continuation on one idle edge #when flushed #then exactly one injection is delivered in deterministic order", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue the run" })

    // when
    const collapsed = coordinator.flushOnIdle()

    // then
    expect(collapsed).toBe(2)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toBe("task st_1 completed\n\ncontinue the run")
    expect(calls[0]?.options).toEqual({ deliverAs: "steer" })
  })

  it("#given repeated continuation enqueues #when flushed #then they collapse to one keyed injection", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue A" })
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue B" })

    // then
    expect(coordinator.pendingCount()).toBe(1)

    // when
    coordinator.flushOnIdle()

    // then the latest continuation content wins, delivered once
    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toBe("continue B")
  })

  it("#given a queued injection #when removed by key #then the flush no-ops and removal reports true only once", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "team-message:m1", source: "team-message", content: "x" })

    // when / then
    expect(coordinator.remove("team-message:m1")).toBe(true)
    expect(coordinator.remove("team-message:m1")).toBe(false)
    expect(coordinator.flushOnIdle()).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it("#given an empty queue #when flushed #then nothing is delivered", () => {
    // given
    const { coordinator, calls } = createCoordinator()

    // when
    const collapsed = coordinator.flushOnIdle()

    // then
    expect(collapsed).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it("#given a deferred scheduleFlush #when the scheduler runs it #then delivery happens on the idle tick, not synchronously", () => {
    // given a manual scheduler that captures the deferred flush
    const calls: DeliveredCall[] = []
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((content, options) => calls.push({ content, options }), {
      scheduleFlush: (flush) => scheduled.push(flush),
    })
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue" })

    // when scheduleFlush is requested
    coordinator.scheduleFlush()

    // then nothing is delivered yet
    expect(calls).toHaveLength(0)

    // when the idle tick runs the deferred flush
    for (const flush of scheduled) flush()

    // then it is delivered exactly once
    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toBe("continue")
  })

  it("#given a deferred continuation #when a synchronous wake flushOnIdle drains first #then the deferred pass no-ops", () => {
    // given a continuation enqueued with a deferred flush pending
    const calls: DeliveredCall[] = []
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((content, options) => calls.push({ content, options }), {
      scheduleFlush: (flush) => scheduled.push(flush),
    })
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue the run" })
    coordinator.scheduleFlush()

    // when a completion wake drains synchronously on the same idle edge
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })
    coordinator.flushOnIdle()

    // then exactly one injection carried both, completion first
    expect(calls).toHaveLength(1)
    expect(calls[0]?.content).toBe("task st_1 completed\n\ncontinue the run")

    // and running the deferred flush adds nothing (queue already drained)
    for (const flush of scheduled) flush()
    expect(calls).toHaveLength(1)
  })

  it("#given repeated scheduleFlush requests before the deferred pass #when scheduled #then they coalesce to one flush", () => {
    // given
    let scheduledCount = 0
    const runnables: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator(() => undefined, {
      scheduleFlush: (flush) => {
        scheduledCount += 1
        runnables.push(flush)
      },
    })

    // when scheduleFlush is requested several times before the deferred pass runs
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue" })
    coordinator.scheduleFlush()
    coordinator.scheduleFlush()
    coordinator.scheduleFlush()

    // then only one deferred flush was scheduled
    expect(scheduledCount).toBe(1)

    // and after it runs, a fresh request schedules again
    for (const flush of runnables) flush()
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "again" })
    coordinator.scheduleFlush()
    expect(scheduledCount).toBe(2)
  })

  it("#given an injection callback w2lead #when the queue flushes #then onFlushed runs synchronously after delivery returns", () => {
    // given
    const order: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => {
      order.push("deliver")
    })
    coordinator.enqueue({
      key: "team-message:m1",
      source: "team-message",
      content: "alpha: ready",
      onFlushed: () => order.push("flushed"),
    })

    // when
    coordinator.flushOnIdle()

    // then
    expect(order).toEqual(["deliver", "flushed"])
  })
})
