import { describe, expect, test } from "bun:test"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createParentNotifier } from "./parent-notifier"
import { createTeamMessageNotifier } from "./team-message-notifier"

type SentMessage = { readonly message: Record<string, unknown>; readonly options: Record<string, unknown> | undefined }

function fakePi(): SenpiExtensionAPI & { readonly sent: SentMessage[] } {
  const sent: SentMessage[] = []
  return {
    sent,
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage: (message, options) => {
      sent.push({ message, options })
    },
    sendUserMessage: () => undefined,
    registerMessageRenderer: () => undefined,
  }
}

function deferredCoordinator(delivered: string[]): { coordinator: IdleInjectionCoordinator; runDeferred: () => void } {
  let pending: (() => void) | undefined
  const coordinator = new IdleInjectionCoordinator((content) => delivered.push(content), {
    scheduleFlush: (flush) => {
      pending = flush
    },
  })
  return { coordinator, runDeferred: () => pending?.() }
}

describe("team-message notifier + shared idle coordinator", () => {
  test("#given a lead message and a completion on one idle edge #when both wake #then exactly one injection", () => {
    // given
    const delivered: string[] = []
    const { coordinator, runDeferred } = deferredCoordinator(delivered)
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi, coordinator)
    const completionNotifier = createParentNotifier(pi, coordinator)

    // when: the team lead-message wake enqueues + defers, then the completion wake flushes synchronously
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: shipped", display: false, from: "beta", messageId: "m1", triggerTurn: true })
    completionNotifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: [{ task_id: "st_1", name: "worker", status: "completed", duration_ms: 10, final_response_head: "ok", continuation_hint: "continue" }],
      triggerTurn: true,
    })

    // then: the synchronous completion flush drains BOTH into one injection
    expect(delivered).toHaveLength(1)
    expect(delivered[0]).toContain("st_1 completed")
    expect(delivered[0]).toContain("beta: shipped")

    // and: the deferred team flush finds an empty queue and no-ops
    runDeferred()
    expect(delivered).toHaveLength(1)
    expect(pi.sent).toHaveLength(0)
  })

  test("#given the same lead message enqueued twice (retry) #when flushed #then it injects once", () => {
    // given
    const delivered: string[] = []
    const { coordinator, runDeferred } = deferredCoordinator(delivered)
    const teamNotifier = createTeamMessageNotifier(fakePi(), coordinator)
    const wake = { customType: "senpi-task.team-message", content: "beta: done", display: false, from: "beta", messageId: "m1", triggerTurn: true } as const

    // when: the engine's enqueue-with-retry double-fires the SAME message id
    teamNotifier.enqueue(wake)
    teamNotifier.enqueue(wake)

    // then: the coordinator dedupes on the message id, so a single injection is pending
    expect(coordinator.pendingCount()).toBe(1)
    runDeferred()
    expect(delivered).toHaveLength(1)
  })

  test("#given a streaming (non-wake) lead message #when enqueued #then it routes to the rich renderer channel, not the coordinator", () => {
    // given
    const delivered: string[] = []
    const { coordinator } = deferredCoordinator(delivered)
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi, coordinator)

    // when
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: fyi", display: false, from: "beta", messageId: "m2", deliverAs: "followUp" })

    // then
    expect(coordinator.pendingCount()).toBe(0)
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.team-message")
    expect(pi.sent[0]?.options).toMatchObject({ deliverAs: "followUp" })
  })

  test("#given a streaming lead message carrying BOTH triggerTurn and deliverAs:steer #when enqueued #then it delivers directly via the renderer with steer preserved, not the coordinator", () => {
    // given: the engine now stamps a streaming lead message with triggerTurn:true AND the configured deliverAs
    const delivered: string[] = []
    const { coordinator } = deferredCoordinator(delivered)
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi, coordinator)

    // when
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: steering", display: false, from: "beta", messageId: "m3", triggerTurn: true, deliverAs: "steer" })

    // then: it bypasses the idle-edge arbiter and reaches the rich channel with steer + triggerTurn intact
    expect(coordinator.pendingCount()).toBe(0)
    expect(delivered).toHaveLength(0)
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.team-message")
    expect(pi.sent[0]?.message.details).toEqual({ from: "beta", messageId: "m3" })
    expect(pi.sent[0]?.options).toMatchObject({ deliverAs: "steer", triggerTurn: true })
  })
})
