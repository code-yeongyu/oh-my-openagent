import { describe, expect, test } from "bun:test"

import type { ParentNotifierMessage } from "@oh-my-opencode/senpi-task"

import { IdleInjectionCoordinator } from "../../extension/idle-injection-coordinator"
import type { SenpiExtensionAPI } from "../../extension/types"
import { createParentNotifier } from "./parent-notifier"

function completionMessage(taskId: string): ParentNotifierMessage {
  return {
    customType: "senpi-task.completion",
    content: `${taskId} completed`,
    display: false,
    details: [{
      task_id: taskId,
      name: "worker",
      status: "completed",
      model: "openai/gpt-5.6-luna-fast",
      duration_ms: 10,
      final_response: "done",
      continuation_hint: "",
    }],
    triggerTurn: true,
  }
}

function deferredDelivery(): {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: unknown) => void
} {
  let resolvePromise: (() => void) | undefined
  let rejectPromise: ((error: unknown) => void) | undefined
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return {
    promise,
    resolve: () => resolvePromise?.(),
    reject: (error) => rejectPromise?.(error),
  }
}

function fakePi(sendMessage: SenpiExtensionAPI["sendMessage"]): SenpiExtensionAPI {
  return {
    on: () => undefined,
    registerTool: () => undefined,
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    sendMessage,
    sendUserMessage: () => undefined,
  }
}

describe("createParentNotifier delivery acknowledgement", () => {
  test("#given coordinator delivery is pending #when a completion enqueues #then cmux waits for the successful flush", async () => {
    // given
    const delivery = deferredDelivery()
    const notified: ParentNotifierMessage[] = []
    const coordinator = new IdleInjectionCoordinator(() => delivery.promise, { scheduleFlush: () => undefined })
    const notifier = createParentNotifier(fakePi(() => undefined), coordinator, () => true, {
      notify: (message) => notified.push(message),
    })

    // when
    const receipt = notifier.enqueue(completionMessage("st_1"))
    coordinator.flushOnIdle()

    // then cmux remains silent until the coordinator's delivery Promise resolves
    expect(receipt).toBeInstanceOf(Promise)
    expect(notified).toHaveLength(0)
    delivery.resolve()
    await receipt
    expect(notified.map((message) => message.details[0]?.task_id)).toEqual(["st_1"])
  })

  test("#given coordinator delivery rejects #when its flush settles #then the receipt rejects and cmux stays silent", async () => {
    // given
    const delivery = deferredDelivery()
    const notified: ParentNotifierMessage[] = []
    const coordinator = new IdleInjectionCoordinator(() => delivery.promise, { scheduleFlush: () => undefined })
    const notifier = createParentNotifier(fakePi(() => undefined), coordinator, () => true, {
      notify: (message) => notified.push(message),
    })

    // when
    const receipt = notifier.enqueue(completionMessage("st_1"))
    coordinator.flushOnIdle()
    delivery.reject(new Error("flush rejected"))

    // then
    expect(receipt).toBeInstanceOf(Promise)
    await expect(receipt).rejects.toThrow("flush rejected")
    expect(notified).toHaveLength(0)
  })

  test("#given direct sendMessage rejects asynchronously #when a completion enqueues #then cmux stays silent", async () => {
    // given
    const delivery = deferredDelivery()
    const notified: ParentNotifierMessage[] = []
    const notifier = createParentNotifier(fakePi(() => delivery.promise), undefined, undefined, {
      notify: (message) => notified.push(message),
    })

    // when
    const receipt = notifier.enqueue(completionMessage("st_1"))
    delivery.reject(new Error("send rejected"))

    // then
    expect(receipt).toBeInstanceOf(Promise)
    await expect(receipt).rejects.toThrow("send rejected")
    expect(notified).toHaveLength(0)
  })

  test("#given two completions share one coordinator delivery #when it succeeds #then each native notice fires exactly once afterward", async () => {
    // given
    const delivery = deferredDelivery()
    const notified: ParentNotifierMessage[] = []
    const coordinator = new IdleInjectionCoordinator(() => delivery.promise, { scheduleFlush: () => undefined })
    const notifier = createParentNotifier(fakePi(() => undefined), coordinator, () => true, {
      notify: (message) => notified.push(message),
    })

    // when
    const first = notifier.enqueue(completionMessage("st_1"))
    const second = notifier.enqueue(completionMessage("st_2"))
    coordinator.flushOnIdle()
    delivery.resolve()
    await Promise.all([first, second])

    // then
    expect(notified.map((message) => message.details[0]?.task_id)).toEqual(["st_1", "st_2"])
  })
})
