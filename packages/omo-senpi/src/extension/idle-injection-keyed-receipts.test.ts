import { describe, expect, test } from "bun:test"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import type { AdmissionItem } from "./idle-injection-items"

type Answer = (items: readonly AdmissionItem[]) => unknown

function coordinatorAnswering(answer: Answer) {
  const sends: (readonly AdmissionItem[])[] = []
  const coordinator = new IdleInjectionCoordinator((_message, options) => {
    sends.push(options.items)
    return answer(options.items)
  })
  return { coordinator, sends }
}

const settled = async () => { await Promise.resolve(); await Promise.resolve() }

describe("M4: one entry per key, every enqueue settled", () => {
  test("#given two enqueues under one key #when flushed #then the latest content is the one item sent and both enqueues are acknowledged", async () => {
    const { coordinator, sends } = coordinatorAnswering(() => undefined)
    const receipts: string[] = []
    for (const content of ["continue A", "continue B"]) coordinator.enqueue({
      key: "ulw", source: "ulw-continuation", content,
      onFlushed: () => { receipts.push(`flushed:${content}`) },
      onDeliveryFailed: () => { receipts.push(`failed:${content}`) },
    })
    expect(coordinator.pendingCount()).toBe(1)
    coordinator.flushOnIdle()
    await settled()
    expect(sends.map(items => items.map(item => item.content))).toEqual([["continue B"]])
    expect(receipts.toSorted()).toEqual(["flushed:continue A", "flushed:continue B"])
  })

  test("#given a superseded enqueue #when the survivor is held as a notice #then the superseded enqueue is held under the survivor's receipt", async () => {
    const { coordinator } = coordinatorAnswering(items => items.map(item => ({
      itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition: "notice_persisted",
    })))
    const held: string[] = []
    for (const content of ["first", "second"]) coordinator.enqueue({
      key: "goal", source: "ulw-continuation", content, runRef: { kind: "dag", id: "run-1" },
      onHeld: receipt => { held.push(`${content}:${receipt.entryId}`) },
      onFlushed: () => { throw new Error("a held wake is not delivered") },
    })
    coordinator.flushOnIdle()
    await settled()
    expect(held.toSorted()).toEqual(["first:held-batch", "second:held-batch"])
  })

  test("#given a superseded enqueue #when delivery fails #then both enqueues receive the failure", async () => {
    const { coordinator } = coordinatorAnswering(() => Promise.reject(new Error("engine gone")))
    const failures: string[] = []
    for (const content of ["first", "second"]) coordinator.enqueue({
      key: "goal", source: "ulw-continuation", content, onDeliveryFailed: () => { failures.push(content) },
    })
    coordinator.flushOnIdle()
    await settled()
    expect(failures.toSorted()).toEqual(["first", "second"])
  })
})

describe("M6: a held receipt without a held callback still acknowledges", () => {
  test("#given a producer with only onFlushed #when its item is held as a notice #then onFlushed runs once and nothing fails", async () => {
    const { coordinator } = coordinatorAnswering(items => items.map(item => ({
      itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition: "notice_persisted",
    })))
    let flushed = 0
    const failures: unknown[] = []
    coordinator.enqueue({
      key: "workpool:wp_1:1", source: "workpool-aggregate", content: "pool done", runRef: { kind: "workpool", id: "wp_1" },
      onFlushed: () => { flushed += 1 }, onDeliveryFailed: error => { failures.push(error) },
    })
    coordinator.flushOnIdle()
    await settled()
    expect(flushed).toBe(1)
    expect(failures).toEqual([])
  })
})
