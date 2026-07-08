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

type Delivered = { content: string; deliverAs: "steer" | "followUp" }

// A manually-driven flush scheduler stands in for the production batch-window timer so the tests
// control exactly when the deferred flush runs (everything enqueued before it batches together).
function coordinatorWithManualFlush(delivered: Delivered[]): { coordinator: IdleInjectionCoordinator; runFlush: () => void } {
  let pending: (() => void) | undefined
  const coordinator = new IdleInjectionCoordinator(
    (content, options) => delivered.push({ content, deliverAs: options.deliverAs }),
    { scheduleFlush: (flush) => { pending = flush } },
  )
  return {
    coordinator,
    runFlush: () => {
      pending?.()
      pending = undefined
    },
  }
}

const completionDetails = [
  { task_id: "st_1", name: "worker", status: "completed" as const, duration_ms: 10, final_response_head: "ok", continuation_hint: "continue" },
]

function completionMessage(taskId: string) {
  return {
    customType: "senpi-task.completion" as const,
    content: `${taskId} completed`,
    display: false,
    details: [{ ...completionDetails[0]!, task_id: taskId }],
    triggerTurn: true,
  }
}

describe("createParentNotifier batched steer delivery", () => {
  test("#given one completion #when enqueued #then it defers through the coordinator and flushes as ONE steer", () => {
    // given
    const delivered: Delivered[] = []
    const { coordinator, runFlush } = coordinatorWithManualFlush(delivered)
    const pi = fakePi()
    const notifier = createParentNotifier(pi, coordinator, () => true)

    // when: the parent is STREAMING, so the completion collects in the batch window
    notifier.enqueue(completionMessage("st_1"))

    // then nothing delivers synchronously (the batch window is open)
    expect(delivered).toHaveLength(0)
    expect(pi.sent).toHaveLength(0)

    // when the batch window closes
    runFlush()

    // then exactly one steer injection carries the completion
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.content).toContain("st_1 completed")
    expect(delivered[0]?.deliverAs).toBe("steer")
    expect(pi.userSent).toHaveLength(0)
  })

  test("#given two near-simultaneous completions #when the batch window closes #then BOTH arrive in ONE steer injection", () => {
    // given
    const delivered: Delivered[] = []
    const { coordinator, runFlush } = coordinatorWithManualFlush(delivered)
    const pi = fakePi()
    const notifier = createParentNotifier(pi, coordinator, () => true)

    // when two children complete inside the same batch window (streaming parent)
    notifier.enqueue(completionMessage("st_1"))
    notifier.enqueue(completionMessage("st_2"))
    runFlush()

    // then the parent receives exactly ONE steer carrying both notifications
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.deliverAs).toBe("steer")
    expect(delivered[0]?.content).toContain("st_1 completed")
    expect(delivered[0]?.content).toContain("st_2 completed")
  })

  test("#given a re-enqueue of the same completion #when the batch window closes #then the key dedupes to one entry", () => {
    // given
    const delivered: Delivered[] = []
    const { coordinator, runFlush } = coordinatorWithManualFlush(delivered)
    const notifier = createParentNotifier(fakePi(), coordinator, () => true)

    // when the engine's sync-throw retry re-enqueues the same message (streaming parent)
    notifier.enqueue(completionMessage("st_1"))
    notifier.enqueue(completionMessage("st_1"))
    runFlush()

    // then it never double-injects
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.content.match(/st_1 completed/g)).toHaveLength(1)
  })

  test("#given an IDLE parent #when two completions land in the same tick #then one microtask steer carries both", async () => {
    // given: no manual scheduler - the idle path flushes itself on the next microtask
    const delivered: Delivered[] = []
    const coordinator = new IdleInjectionCoordinator(
      (content, options) => delivered.push({ content, deliverAs: options.deliverAs }),
    )
    const notifier = createParentNotifier(fakePi(), coordinator, () => false)

    // when both completions land in the same tick
    notifier.enqueue(completionMessage("st_1"))
    notifier.enqueue(completionMessage("st_2"))
    expect(delivered).toHaveLength(0)
    await Promise.resolve()

    // then delivery is immediate (no exit race in print mode) and still batched into ONE steer
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.deliverAs).toBe("steer")
    expect(delivered[0]?.content).toContain("st_1 completed")
    expect(delivered[0]?.content).toContain("st_2 completed")
  })

  test("#given no coordinator is wired #when a completion enqueues #then it falls back to a direct steer on the renderer channel", () => {
    // given
    const pi = fakePi()
    const notifier = createParentNotifier(pi)

    // when
    notifier.enqueue(completionMessage("st_1"))

    // then the completion still steers into the running turn through the rich channel
    expect(pi.sent).toHaveLength(1)
    expect(pi.sent[0]?.options).toMatchObject({ triggerTurn: true, deliverAs: "steer" })
    expect(pi.sent[0]?.message.customType).toBe("senpi-task.completion")
  })
})
