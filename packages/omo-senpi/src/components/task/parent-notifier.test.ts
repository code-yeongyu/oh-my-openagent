import { describe, expect, test } from "bun:test"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createParentNotifier } from "./parent-notifier"

type SentMessage = { readonly message: Record<string, unknown>; readonly options: Record<string, unknown> | undefined }
type SentUserMessage = { readonly content: string | readonly Record<string, unknown>[]; readonly options: { deliverAs?: "steer" | "followUp" } | undefined }

function fakePi(): SenpiExtensionAPI & { readonly sent: SentMessage[]; readonly userSent: SentUserMessage[] } {
  const sent: SentMessage[] = []
  const userSent: SentUserMessage[] = []
  return {
    sent,
    userSent,
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage: (message, options) => {
      sent.push({ message, options })
    },
    sendUserMessage: (content, options) => {
      userSent.push({ content, options })
    },
    registerMessageRenderer: () => undefined,
  }
}

function coordinatorCapturing(delivered: { content: string; deliverAs: "steer" | "followUp" }[]): IdleInjectionCoordinator {
  return new IdleInjectionCoordinator((content, options) => delivered.push({ content, deliverAs: options.deliverAs }))
}

const completionDetails = [
  { task_id: "st_1", name: "worker", status: "completed" as const, duration_ms: 10, final_response_head: "ok", continuation_hint: "continue" },
]

describe("createParentNotifier idle vs streaming routing", () => {
  test("#given an idle wake (triggerTurn, no deliverAs) #when enqueued #then it routes through the coordinator and collapses", () => {
    // given
    const delivered: { content: string; deliverAs: "steer" | "followUp" }[] = []
    const coordinator = coordinatorCapturing(delivered)
    const pi = fakePi()
    const notifier = createParentNotifier(pi, coordinator)

    // when: a wake completion carries triggerTurn:true and NO deliverAs (the idle-edge arbitration path)
    notifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: completionDetails,
      triggerTurn: true,
    })

    // then: it is arbitrated by the coordinator (one followUp injection), NOT delivered directly
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.content).toContain("st_1 completed")
    expect(delivered[0]?.deliverAs).toBe("followUp")
    expect(pi.sent).toHaveLength(0)
    expect(pi.userSent).toHaveLength(0)
  })

  test("#given a streaming completion (triggerTurn AND deliverAs:steer) #when enqueued #then it delivers DIRECTLY via the renderer channel with steer preserved", () => {
    // given
    const delivered: { content: string; deliverAs: "steer" | "followUp" }[] = []
    const coordinator = coordinatorCapturing(delivered)
    const pi = fakePi()
    const notifier = createParentNotifier(pi, coordinator)

    // when: a STREAMING completion now carries BOTH triggerTurn:true AND the configured deliverAs
    notifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: completionDetails,
      triggerTurn: true,
      deliverAs: "steer",
    })

    // then: it bypasses the coordinator and goes straight to the rich custom-message channel
    expect(delivered).toHaveLength(0)
    expect(pi.userSent).toHaveLength(0)
    expect(pi.sent).toHaveLength(1)
    // and: the configured deliver_as (steer) survives, and triggerTurn rides along
    expect(pi.sent[0]?.options).toMatchObject({ deliverAs: "steer", triggerTurn: true })
    // and: the senpi-task.completion renderer applies (custom message shape, not a plain user message)
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.completion")
    expect(pi.sent[0]?.message.details).toEqual(completionDetails)
  })

  test("#given a streaming completion with deliverAs:followUp #when enqueued #then it delivers directly with followUp preserved", () => {
    // given
    const delivered: { content: string; deliverAs: "steer" | "followUp" }[] = []
    const coordinator = coordinatorCapturing(delivered)
    const pi = fakePi()
    const notifier = createParentNotifier(pi, coordinator)

    // when
    notifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: completionDetails,
      triggerTurn: true,
      deliverAs: "followUp",
    })

    // then
    expect(delivered).toHaveLength(0)
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.options).toMatchObject({ deliverAs: "followUp", triggerTurn: true })
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.completion")
  })

  test("#given no coordinator is wired #when an idle wake enqueues #then it falls back to the direct renderer channel", () => {
    // given
    const pi = fakePi()
    const notifier = createParentNotifier(pi)

    // when
    notifier.enqueue({
      customType: "senpi-task.completion",
      content: "st_1 completed",
      display: false,
      details: completionDetails,
      triggerTurn: true,
    })

    // then: with no arbiter, the wake still reaches the parent through the rich channel
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.options).toMatchObject({ triggerTurn: true })
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.completion")
  })
})
