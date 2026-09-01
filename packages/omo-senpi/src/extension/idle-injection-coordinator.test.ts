import { describe, expect, it } from "bun:test"

import { IdleInjectionCoordinator } from "./idle-injection-coordinator"

interface DeliveredCall {
  content: string
  options: { deliverAs: "steer" | "followUp" }
}

function createCoordinator(): { coordinator: IdleInjectionCoordinator; calls: DeliveredCall[] } {
  const calls: DeliveredCall[] = []
  const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ content: message.content, options }))
  return { coordinator, calls }
}

describe("IdleInjectionCoordinator", () => {
  it("#given hidden metadata #when flushed #then one merged custom message preserves it", () => {
    const calls: Array<{ message: unknown; options: { deliverAs: "steer" | "followUp" } }> = []
    const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ message, options }))
    coordinator.enqueue({
      key: "st_1",
      source: "task-completion",
      customType: "senpi-task:completion",
      content: "task st_1 completed",
      display: false,
      details: { taskId: "st_1" },
    } as never)

    coordinator.flushOnIdle()

    expect(calls).toEqual([
      {
        message: {
          customType: "omo-senpi:wake",
          content: "task st_1 completed",
          display: false,
          details: [{ customType: "senpi-task:completion", details: { taskId: "st_1" } }],
        },
        options: { deliverAs: "steer" },
      },
    ])
  })

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

  it("#given one task completion on an idle edge #when flushed #then it steers immediately", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })

    // when
    coordinator.flushOnIdle()

    // then
    expect(calls).toEqual([
      {
        content: "task st_1 completed",
        options: { deliverAs: "steer" },
      },
    ])
  })

  it("#given two task completions on one idle edge #when flushed #then one steer carries both", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })
    coordinator.enqueue({ key: "st_2", source: "task-completion", content: "task st_2 completed" })

    // when
    coordinator.flushOnIdle()

    // then
    expect(calls).toEqual([
      {
        content: "task st_1 completed\n\ntask st_2 completed",
        options: { deliverAs: "steer" },
      },
    ])
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
    const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ content: message.content, options }), {
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
    expect(calls[0]?.options).toEqual({ deliverAs: "steer" })
  })

  it("#given a deferred continuation #when a synchronous wake flushOnIdle drains first #then the deferred pass no-ops", () => {
    // given a continuation enqueued with a deferred flush pending
    const calls: DeliveredCall[] = []
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ content: message.content, options }), {
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

  it("#given an async delivery rejection #when the queue flushes #then the producer receives a failure receipt and onFlushed does not run", async () => {
    const events: string[] = []
    let rejectDelivery: (error: Error) => void = () => undefined
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject })
    const coordinator = new IdleInjectionCoordinator(() => delivery)
    coordinator.enqueue({
      key: "team-liveness:1",
      source: "team-liveness",
      content: "member failed",
      onFlushed: () => events.push("flushed"),
      onDeliveryFailed: (error) => events.push(error instanceof Error ? error.message : String(error)),
    })

    coordinator.flushOnIdle()
    rejectDelivery(new Error("provider rejected"))
    await Promise.resolve()

    expect(events).toEqual(["provider rejected"])
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
