import { describe, expect, it } from "bun:test"

import { IdleInjectionCoordinator, IdleInjectionRetiredError } from "./idle-injection-coordinator"

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
      scheduleFlush: (flush) => { scheduled.push(flush) },
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
      scheduleFlush: (flush) => { scheduled.push(flush) },
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

  it("#given only a passive kibitzer entry #when flushOnIdle runs #then nothing is delivered and the entry stays queued", () => {
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "kibitzer:1", source: "kibitzer", content: "recall", passive: true })

    expect(coordinator.flushOnIdle()).toBe(0)
    expect(calls).toHaveLength(0)
    expect(coordinator.pendingCount()).toBe(1)
  })

  it("#given a passive kibitzer entry and a task-completion entry #when flushOnIdle runs #then one delivery carries both contents with kibitzer last and the passive onFlushed fires", () => {
    const events: string[] = []
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({
      key: "kibitzer:1",
      source: "kibitzer",
      content: "recall",
      passive: true,
      onFlushed: () => events.push("kibitzer"),
    })
    coordinator.enqueue({ key: "task:1", source: "task-completion", content: "task done" })

    expect(coordinator.flushOnIdle()).toBe(2)
    expect(calls[0]?.content).toBe("task done\n\nrecall")
    expect(events).toEqual(["kibitzer"])
  })

  it("#given a passive entry #when scheduleFlush's deferred pass runs #then nothing is delivered", () => {
    const calls: DeliveredCall[] = []
    const scheduled: Array<() => void> = []
    const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ content: message.content, options }), {
      scheduleFlush: (flush) => { scheduled.push(flush) },
    })
    coordinator.enqueue({ key: "kibitzer:1", source: "kibitzer", content: "recall", passive: true })

    coordinator.scheduleFlush()
    scheduled[0]?.()

    expect(calls).toHaveLength(0)
    expect(coordinator.pendingCount()).toBe(1)
  })

  it("#given a deferred flush pending #when the coordinator is retired before the scheduler runs it #then the flush no-ops and the producer gets a failure receipt", () => {
    // Reproduces https://github.com/code-yeongyu/oh-my-openagent/issues/7932: the injected delivery IS
    // the stale generation, so an unguarded post-retirement flush throws out of the timer queue.
    let deliveries = 0
    const scheduled: Array<() => void> = []
    const failures: unknown[] = []
    const coordinator = new IdleInjectionCoordinator(
      () => {
        deliveries += 1
        throw new Error("stale extension generation after reload")
      },
      { scheduleFlush: (flush) => { scheduled.push(flush) } },
    )
    coordinator.enqueue({
      key: "ulw",
      source: "ulw-continuation",
      content: "continue",
      onDeliveryFailed: (error) => failures.push(error),
    })
    coordinator.scheduleFlush()

    // when the session shuts down before the deferred pass runs
    coordinator.retire()

    // then the armed callback is a no-op instead of throwing into the timer queue
    expect(scheduled).toHaveLength(1)
    for (const flush of scheduled) expect(flush).not.toThrow()
    expect(deliveries).toBe(0)
    expect(coordinator.pendingCount()).toBe(0)
    // and the dropped batch window is reported back, never silently discarded
    expect(failures).toHaveLength(1)
    expect(failures[0]).toBeInstanceOf(IdleInjectionRetiredError)
  })

  it("#given queued injections with receipts #when the coordinator retires #then every accepted entry is handed back as a delivery failure", () => {
    // given two accepted injections, one of them with no receipt at all
    const { coordinator, calls } = createCoordinator()
    const failed: string[] = []
    const flushed: string[] = []
    coordinator.enqueue({
      key: "st_1",
      source: "task-completion",
      content: "task st_1 completed",
      onFlushed: () => flushed.push("st_1"),
      onDeliveryFailed: () => failed.push("st_1"),
    })
    coordinator.enqueue({
      key: "team-liveness:1",
      source: "team-liveness",
      content: "member failed",
      onDeliveryFailed: () => failed.push("team-liveness:1"),
    })
    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue" })

    // when
    coordinator.retire()

    // then each accepted entry got exactly one receipt, and it was the failure one
    expect(failed).toEqual(["st_1", "team-liveness:1"])
    expect(flushed).toEqual([])
    expect(calls).toHaveLength(0)
    expect(coordinator.pendingCount()).toBe(0)
  })

  it("#given an armed batch-window timer #when the coordinator retires #then the scheduler's canceller runs", () => {
    // given a scheduler that hands back a canceller, like the production 200ms setTimeout window
    let cancelled = 0
    const coordinator = new IdleInjectionCoordinator(() => undefined, {
      scheduleFlush: () => () => {
        cancelled += 1
      },
    })
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })
    coordinator.scheduleFlush()

    // when
    coordinator.retire()

    // then the armed handle is cancelled rather than left live for the rest of the process
    expect(cancelled).toBe(1)
  })

  it("#given a retired coordinator #when a late producer enqueues #then the enqueue is refused with no receipt", () => {
    // given
    const { coordinator, calls } = createCoordinator()
    const receipts: string[] = []
    coordinator.retire()

    // when
    const accepted = coordinator.enqueue({
      key: "st_1",
      source: "task-completion",
      content: "task st_1 completed",
      onFlushed: () => receipts.push("flushed"),
      onDeliveryFailed: () => receipts.push("failed"),
    })

    // then the caller learns synchronously that it still owns the notification: refused, not queued,
    // and no receipt (ownership never transferred).
    expect(accepted).toBe(false)
    expect(coordinator.pendingCount()).toBe(0)
    expect(receipts).toEqual([])
    expect(coordinator.flushOnIdle()).toBe(0)
    expect(calls).toHaveLength(0)
  })

  it("#given a flushSoon microtask pending #when the coordinator is retired before the microtask runs #then nothing is delivered", async () => {
    // given
    const { coordinator, calls } = createCoordinator()
    coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })
    coordinator.flushSoon()

    // when
    coordinator.retire()
    await Promise.resolve()

    // then
    expect(calls).toHaveLength(0)
    expect(coordinator.pendingCount()).toBe(0)
  })

  it("#given a retired coordinator #when a late producer enqueues and schedules #then no flush is scheduled and the queue stays empty", async () => {
    // given
    let scheduledCount = 0
    const calls: DeliveredCall[] = []
    const coordinator = new IdleInjectionCoordinator((message, options) => calls.push({ content: message.content, options }), {
      scheduleFlush: (flush) => {
        scheduledCount += 1
        flush()
      },
    })
    coordinator.retire()

    // when
    expect(coordinator.enqueue({ key: "st_1", source: "task-completion", content: "task st_1 completed" })).toBe(false)
    coordinator.scheduleFlush()
    coordinator.flushSoon()
    await Promise.resolve()

    // then no batch-window handle is armed for a session that is already gone
    expect(scheduledCount).toBe(0)
    expect(coordinator.pendingCount()).toBe(0)
    expect(coordinator.flushOnIdle()).toBe(0)
    expect(calls).toHaveLength(0)
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
