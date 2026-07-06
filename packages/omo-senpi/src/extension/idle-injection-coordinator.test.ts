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
    expect(calls[0]?.options).toEqual({ deliverAs: "followUp" })
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

  it("#given an empty queue #when flushed #then nothing is delivered", () => {
    // given
    const { coordinator, calls } = createCoordinator()

    // when
    const collapsed = coordinator.flushOnIdle()

    // then
    expect(collapsed).toBe(0)
    expect(calls).toHaveLength(0)
  })
})
