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

type Delivered = { content: string; deliverAs: "steer" | "followUp" }

function deferredCoordinator(delivered: Delivered[]): { coordinator: IdleInjectionCoordinator; runDeferred: () => void } {
  let pending: (() => void) | undefined
  const coordinator = new IdleInjectionCoordinator(
    (content, options) => delivered.push({ content, deliverAs: options.deliverAs }),
    {
      scheduleFlush: (flush) => {
        pending = flush
      },
    },
  )
  return {
    coordinator,
    runDeferred: () => {
      pending?.()
      pending = undefined
    },
  }
}

describe("team-message notifier + shared idle coordinator", () => {
  test("#given a lead message and a completion in one batch window #when flushed #then exactly one steer injection", () => {
    // given
    const delivered: Delivered[] = []
    const { coordinator, runDeferred } = deferredCoordinator(delivered)
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi, coordinator, () => true)
    const completionNotifier = createParentNotifier(pi, coordinator, () => true)

    // when: both become ready inside the same batch window
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: shipped", display: false, from: "beta", messageId: "m1", triggerTurn: true })
    completionNotifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: [{ task_id: "st_1", name: "worker", status: "completed", duration_ms: 10, final_response_head: "ok", continuation_hint: "continue" }],
      triggerTurn: true,
    })

    // then: nothing delivers until the window closes
    expect(delivered).toHaveLength(0)

    // when the batch window closes
    runDeferred()

    // then: ONE steer injection carries both, in deterministic completion-first order
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.deliverAs).toBe("steer")
    expect(delivered[0]?.content).toContain("st_1 completed")
    expect(delivered[0]?.content).toContain("beta: shipped")
    expect(delivered[0]?.content.indexOf("st_1 completed")).toBeLessThan(delivered[0]?.content.indexOf("beta: shipped") ?? -1)
    expect(pi.sent).toHaveLength(0)
  })

  test("#given the same lead message enqueued twice (retry) #when flushed #then it injects once", () => {
    // given
    const delivered: Delivered[] = []
    const { coordinator, runDeferred } = deferredCoordinator(delivered)
    const teamNotifier = createTeamMessageNotifier(fakePi(), coordinator, () => true)
    const wake = { customType: "senpi-task.team-message", content: "beta: done", display: false, from: "beta", messageId: "m1", triggerTurn: true } as const

    // when: the engine's enqueue-with-retry double-fires the SAME message id
    teamNotifier.enqueue(wake)
    teamNotifier.enqueue(wake)

    // then: the coordinator dedupes on the message id, so a single injection is pending
    expect(coordinator.pendingCount()).toBe(1)
    runDeferred()
    expect(delivered).toHaveLength(1)
  })

  test("#given a streaming lead message #when enqueued #then it also batches through the coordinator as steer", () => {
    // given: a streaming lead delivery carries triggerTurn like every delivered notification
    const delivered: Delivered[] = []
    const { coordinator, runDeferred } = deferredCoordinator(delivered)
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi, coordinator, () => true)

    // when
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: steering", display: false, from: "beta", messageId: "m3", triggerTurn: true })
    runDeferred()

    // then: the coordinator steers the injection; nothing bypasses the batch
    expect(pi.sent).toHaveLength(0)
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.deliverAs).toBe("steer")
    expect(delivered[0]?.content).toContain("beta: steering")
  })

  test("#given no coordinator is wired #when a lead message enqueues #then it falls back to a direct steer on the renderer channel", () => {
    // given
    const pi = fakePi()
    const teamNotifier = createTeamMessageNotifier(pi)

    // when
    teamNotifier.enqueue({ customType: "senpi-task.team-message", content: "beta: fyi", display: false, from: "beta", messageId: "m2", triggerTurn: true })

    // then
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.team-message")
    expect(pi.sent[0]?.message.details).toEqual({ from: "beta", messageId: "m2" })
    expect(pi.sent[0]?.options).toMatchObject({ triggerTurn: true, deliverAs: "steer" })
  })
})
