import { describe, expect, it, spyOn } from "bun:test"

import { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { WAKE_QUEUE_SOURCE, publishWakeQueueBaselineOnSessionStart, publishWakeQueueChildWork } from "./wake-queue-source"

// omo#10782 item 2: a child result waiting in the batch window is children's work the parent still owes.
// The coordinator reports how many child entries are queued or in delivery, so the engine never reads
// the parent as done between a child finishing and its result reaching the parent.
function recordingCoordinator(deliver: () => unknown = () => undefined) {
  const counts: number[] = []
  const coordinator = new IdleInjectionCoordinator(deliver, { onChildWorkChange: (count) => counts.push(count) })
  return { coordinator, counts }
}

const completion = (key: string) => ({ key, source: "task-completion" as const, content: `${key} completed` })

describe("IdleInjectionCoordinator child work count (#10782)", () => {
  it("#given a child completion #when it is queued and then delivered #then the count goes 1 then 0", () => {
    const { coordinator, counts } = recordingCoordinator()

    coordinator.enqueue(completion("task:st_1"))
    expect(counts).toEqual([1])

    coordinator.flushOnIdle()
    expect(counts).toEqual([1, 0])
  })

  it("#given an async delivery #when the queue flushes #then the child stays counted until the delivery resolves", async () => {
    let resolveDelivery: () => void = () => undefined
    const delivery = new Promise<void>((resolve) => { resolveDelivery = resolve })
    const { coordinator, counts } = recordingCoordinator(() => delivery)
    coordinator.enqueue(completion("task:st_2"))

    coordinator.flushOnIdle()
    expect(counts).toEqual([1])

    resolveDelivery()
    await delivery
    await Promise.resolve()
    expect(counts).toEqual([1, 0])
  })

  it("#given an async delivery that rejects #when the producer gets its failure receipt #then the queue no longer counts the child", async () => {
    let rejectDelivery: (error: Error) => void = () => undefined
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject })
    const { coordinator, counts } = recordingCoordinator(() => delivery)
    coordinator.enqueue({ ...completion("task:st_3"), onDeliveryFailed: () => undefined })

    coordinator.flushOnIdle()
    rejectDelivery(new Error("provider rejected"))
    await delivery.catch(() => undefined)
    await Promise.resolve()

    expect(counts).toEqual([1, 0])
  })

  it("#given only continuation and kibitzer entries #when they are queued and flushed #then no child work is reported", () => {
    const { coordinator, counts } = recordingCoordinator()

    coordinator.enqueue({ key: "ulw", source: "ulw-continuation", content: "continue" })
    coordinator.enqueue({ key: "kibitzer:1", source: "kibitzer", content: "recall", passive: true })
    coordinator.flushOnIdle()

    expect(counts).toEqual([])
  })

  it("#given two child results and a removal #when the queue changes #then each distinct count is reported once", () => {
    const { coordinator, counts } = recordingCoordinator()

    coordinator.enqueue(completion("task:st_4"))
    coordinator.enqueue({ key: "dag:run_1", source: "dag-run", content: "run finished" })
    coordinator.enqueue(completion("task:st_4"))
    coordinator.remove("dag:run_1")

    expect(counts).toEqual([1, 2, 1])
  })

  it("#given a queued child result #when the coordinator retires #then the count clears", () => {
    const { coordinator, counts } = recordingCoordinator()
    coordinator.enqueue({ ...completion("task:st_5"), onDeliveryFailed: () => undefined })

    coordinator.retire()

    expect(counts).toEqual([1, 0])
  })
})

describe("publishWakeQueueChildWork", () => {
  it("#given a count #when published #then senpi sees an omo-wake-queue wake source of kind children", () => {
    const emitted: Array<{ name: string; data: unknown }> = []
    const publish = publishWakeQueueChildWork({ events: { emit: (name: string, data: unknown) => emitted.push({ name, data }) } })

    publish(2)
    publish(0)

    expect(emitted).toEqual([
      { name: "wake_source_state", data: { source: WAKE_QUEUE_SOURCE, kind: "children", activeCount: 2 } },
      { name: "wake_source_state", data: { source: WAKE_QUEUE_SOURCE, kind: "children", activeCount: 0 } },
    ])
  })
})

// #11115 review LOWs: a failing publish must never cost a delivery receipt, and a new session generation
// must publish a baseline so a count left by the old one cannot outlive a reload.
describe("wake-queue count vs. delivery receipts (#10782)", () => {
  it("#given a child result #when it is delivered #then its receipt fires before the count is reported", () => {
    const order: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined, { onChildWorkChange: (count) => order.push(`count:${count}`) })
    coordinator.enqueue({ ...completion("task:st_6"), onFlushed: () => order.push("flushed") })

    coordinator.flushOnIdle()

    expect(order).toEqual(["count:1", "flushed", "count:0"])
  })

  it("#given an async delivery that rejects #when it settles #then the failure receipt fires before the count is reported", async () => {
    const order: string[] = []
    let rejectDelivery: (error: Error) => void = () => undefined
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject })
    const coordinator = new IdleInjectionCoordinator(() => delivery, { onChildWorkChange: (count) => order.push(`count:${count}`) })
    coordinator.enqueue({ ...completion("task:st_7"), onDeliveryFailed: () => order.push("failed") })

    coordinator.flushOnIdle()
    rejectDelivery(new Error("provider rejected"))
    await delivery.catch(() => undefined)
    await Promise.resolve()

    expect(order).toEqual(["count:1", "failed", "count:0"])
  })

  it("#given a host whose event bus throws #when the count is published #then the error is logged, not thrown", () => {
    const warnings: string[] = []
    const publish = publishWakeQueueChildWork(
      { events: { emit: () => { throw new Error("stale extension generation") } } },
      { warn: (message: string) => warnings.push(message) },
    )

    expect(() => publish(1)).not.toThrow()
    expect(warnings).toHaveLength(1)
  })

  it("#given a new session generation #when session_start fires #then the current count is published as a baseline", async () => {
    const emitted: unknown[] = []
    const pi = new FakeExtensionAPI()
    pi.events = { emit: (_name, data) => emitted.push(data), on: () => () => {} }
    publishWakeQueueBaselineOnSessionStart(pi, () => 0, publishWakeQueueChildWork(pi))

    await pi.dispatch("session_start", { type: "session_start" })

    expect(emitted).toEqual([{ source: WAKE_QUEUE_SOURCE, kind: "children", activeCount: 0 }])
  })
})

// #11121 review: a receipt that throws must not leave the child counted (the session would never reach done).
describe("wake-queue count when a receipt throws (#10782)", () => {
  it("#given a receipt that throws #when the delivery succeeds #then the count still settles to 0", () => {
    const counts: number[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined, { onChildWorkChange: (count) => counts.push(count) })
    coordinator.enqueue({ ...completion("task:st_8"), onFlushed: () => { throw new Error("receipt failed") } })

    expect(() => coordinator.flushOnIdle()).toThrow("receipt failed")
    expect(counts).toEqual([1, 0])
  })

  it("#given a delivery that throws synchronously #when its receipt also throws #then the count still settles to 0", () => {
    const counts: number[] = []
    const coordinator = new IdleInjectionCoordinator(() => { throw new Error("delivery failed") }, { onChildWorkChange: (count) => counts.push(count) })
    coordinator.enqueue({ ...completion("task:st_9"), onDeliveryFailed: () => { throw new Error("receipt failed") } })

    expect(() => coordinator.flushOnIdle()).toThrow()
    expect(counts).toEqual([1, 0])
  })

  it("#given an async delivery that resolves #when it settles #then the receipt fires before the count is reported", async () => {
    const order: string[] = []
    let resolveDelivery: () => void = () => undefined
    const delivery = new Promise<void>((resolve) => { resolveDelivery = resolve })
    const coordinator = new IdleInjectionCoordinator(() => delivery, { onChildWorkChange: (count) => order.push(`count:${count}`) })
    coordinator.enqueue({ ...completion("task:st_10"), onFlushed: () => order.push("flushed") })

    coordinator.flushOnIdle()
    resolveDelivery()
    await delivery
    await Promise.resolve()

    expect(order).toEqual(["count:1", "flushed", "count:0"])
  })
})

// #11122 review: one producer's throwing receipt must not cost the others theirs, a receipt error must not
// replace the delivery error, and an async receipt error must be reported instead of escaping unhandled.
describe("delivery receipts are isolated from each other (#10782)", () => {
  it("#given two injections in one batch #when the first receipt throws #then the second still gets its receipt", () => {
    const flushed: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined)
    coordinator.enqueue({ ...completion("task:st_11"), onFlushed: () => { throw new Error("first receipt failed") } })
    coordinator.enqueue({ ...completion("task:st_12"), onFlushed: () => flushed.push("task:st_12") })

    expect(() => coordinator.flushOnIdle()).toThrow("first receipt failed")
    expect(flushed).toEqual(["task:st_12"])
  })

  it("#given a delivery that throws synchronously #when a receipt also throws #then the delivery error surfaces", () => {
    const coordinator = new IdleInjectionCoordinator(() => { throw new Error("delivery failed") })
    coordinator.enqueue({ ...completion("task:st_13"), onDeliveryFailed: () => { throw new Error("receipt failed") } })

    expect(() => coordinator.flushOnIdle()).toThrow("delivery failed")
  })

  it("#given an async delivery that rejects #when a receipt throws #then the error is reported, the count settles, and the order holds", async () => {
    const order: string[] = []
    const reported: unknown[] = []
    let rejectDelivery: (error: Error) => void = () => undefined
    const delivery = new Promise<void>((_resolve, reject) => { rejectDelivery = reject })
    const coordinator = new IdleInjectionCoordinator(() => delivery, {
      onChildWorkChange: (count) => order.push(`count:${count}`),
      onReceiptError: (error) => reported.push(error),
    })
    coordinator.enqueue({ ...completion("task:st_14"), onDeliveryFailed: () => { order.push("failed"); throw new Error("receipt failed") } })

    coordinator.flushOnIdle()
    rejectDelivery(new Error("provider rejected"))
    await delivery.catch(() => undefined)
    await Promise.resolve()

    expect(order).toEqual(["count:1", "failed", "count:0"])
    expect(reported.map((error) => (error as Error).message)).toEqual(["receipt failed"])
  })
})

// #11123 review: retire() must isolate receipts as #flush does, a thenable whose then() throws must still settle,
// and a receipt error that is not rethrown must be reported, never dropped.
describe("receipts on retire and on a broken thenable (#10782)", () => {
  it("#given two queued injections #when retire() and the first failure receipt throws #then the second still gets its receipt", () => {
    const failed: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined, { scheduleFlush: () => undefined })
    coordinator.enqueue({ ...completion("task:st_15"), onDeliveryFailed: () => { throw new Error("first receipt failed") } })
    coordinator.enqueue({ ...completion("task:st_16"), onDeliveryFailed: () => failed.push("task:st_16") })

    expect(() => coordinator.retire()).toThrow("first receipt failed")
    expect(failed).toEqual(["task:st_16"])
  })

  it("#given a thenable whose then() throws #when it is delivered #then the failure receipt fires and the count settles", () => {
    const counts: number[] = []
    const failed: string[] = []
    const broken = { then: () => { throw new Error("then failed") } }
    const coordinator = new IdleInjectionCoordinator(() => broken as unknown as Promise<void>, { onChildWorkChange: (count) => counts.push(count) })
    coordinator.enqueue({ ...completion("task:st_17"), onDeliveryFailed: () => failed.push("task:st_17") })

    expect(() => coordinator.flushOnIdle()).toThrow("then failed")
    expect(failed).toEqual(["task:st_17"])
    expect(counts).toEqual([1, 0])
  })

  it("#given a sync delivery throw #when two receipts also throw #then both receipt errors are reported, not dropped", () => {
    const reported: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => { throw new Error("delivery failed") }, {
      onReceiptError: (error) => reported.push((error as Error).message),
    })
    coordinator.enqueue({ ...completion("task:st_18"), onDeliveryFailed: () => { throw new Error("receipt one") } })
    coordinator.enqueue({ ...completion("task:st_19"), onDeliveryFailed: () => { throw new Error("receipt two") } })

    expect(() => coordinator.flushOnIdle()).toThrow("delivery failed")
    expect(reported).toEqual(["receipt one", "receipt two"])
  })

  it("#given a successful sync delivery #when two receipts throw #then the first is rethrown and the second is reported", () => {
    const reported: string[] = []
    const coordinator = new IdleInjectionCoordinator(() => undefined, {
      onReceiptError: (error) => reported.push((error as Error).message),
    })
    coordinator.enqueue({ ...completion("task:st_20"), onFlushed: () => { throw new Error("receipt one") } })
    coordinator.enqueue({ ...completion("task:st_21"), onFlushed: () => { throw new Error("receipt two") } })

    expect(() => coordinator.flushOnIdle()).toThrow("receipt one")
    expect(reported).toEqual(["receipt two"])
  })

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["0", 0],
    ["an empty string", ""],
  ])("#given a receipt that throws %s #when the delivery succeeds or the coordinator retires #then the failure still surfaces", (_label, thrown) => {
    // when a successful delivery's only receipt throws a falsy value
    const flushing = new IdleInjectionCoordinator(() => undefined)
    flushing.enqueue({ ...completion("task:st_22"), onFlushed: () => { throw thrown } })
    let flushThrew = false
    try {
      flushing.flushOnIdle()
    } catch {
      flushThrew = true
    }

    // and a retiring coordinator's only failure receipt throws the same value
    const retiring = new IdleInjectionCoordinator(() => undefined, { scheduleFlush: () => undefined })
    retiring.enqueue({ ...completion("task:st_23"), onDeliveryFailed: () => { throw thrown } })
    let retireThrew = false
    try {
      retiring.retire()
    } catch {
      retireThrew = true
    }

    // then neither failure was swallowed
    expect(flushThrew).toBe(true)
    expect(retireThrew).toBe(true)
  })
})

// #11123 review LOWs 2 and 3: a misbehaving thenable settles receipts and the count once, and a throwing
// onReceiptError costs neither the remaining reports nor the delivery error.
describe("receipt settlement and reporting guards (#10782)", () => {
  it("#given a thenable that calls back and then throws #when it is delivered #then receipts and the count settle once", () => {
    const counts: number[] = []
    const flushed: string[] = []
    const failed: string[] = []
    const callsBackThenThrows = {
      then: (onFulfilled: () => void) => {
        onFulfilled()
        throw new Error("then failed after calling back")
      },
    }
    const coordinator = new IdleInjectionCoordinator(() => callsBackThenThrows as unknown as Promise<void>, {
      onChildWorkChange: (count) => counts.push(count),
    })
    coordinator.enqueue({
      ...completion("task:st_24"),
      onFlushed: () => flushed.push("task:st_24"),
      onDeliveryFailed: () => failed.push("task:st_24"),
    })

    expect(() => coordinator.flushOnIdle()).toThrow("then failed after calling back")
    expect(flushed).toEqual(["task:st_24"])
    expect(failed).toEqual([])
    expect(counts).toEqual([1, 0])
  })

  it("#given an onReceiptError that throws #when two receipts throw on a failed delivery #then both are reported and the delivery error surfaces", () => {
    const reported: string[] = []
    const consoleError = spyOn(console, "error").mockImplementation(() => undefined)
    try {
      const coordinator = new IdleInjectionCoordinator(() => { throw new Error("delivery failed") }, {
        onReceiptError: (error) => {
          reported.push((error as Error).message)
          throw new Error("reporter failed")
        },
      })
      coordinator.enqueue({ ...completion("task:st_25"), onDeliveryFailed: () => { throw new Error("receipt one") } })
      coordinator.enqueue({ ...completion("task:st_26"), onDeliveryFailed: () => { throw new Error("receipt two") } })

      expect(() => coordinator.flushOnIdle()).toThrow("delivery failed")
      expect(reported).toEqual(["receipt one", "receipt two"])
      expect(consoleError).toHaveBeenCalledTimes(2)
    } finally {
      consoleError.mockRestore()
    }
  })
})
