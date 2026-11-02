import { describe, expect, test } from "bun:test"
import { deliverItems } from "./deliver-items"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"

type Sent = { readonly content: string; readonly options: Record<string, unknown> }

function coordinatorOver(answer: (items: readonly { readonly itemId: string }[]) => unknown) {
  const sent: Sent[] = []
  const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((native, delivery) => {
    sent.push({ content: native.content, options: delivery as unknown as Record<string, unknown> })
    return answer(delivery.items)
  }, { ...options, message }))
  return { coordinator, sent }
}

describe("design 30/34: coordinator items carry durable per-item engine receipts", () => {
  test("#given a paused run #when two items of one producer are flushed #then one send names each item and each is held under its own notice in one shared entry", async () => {
    const { coordinator, sent } = coordinatorOver(items => items.map(item => ({
      itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition: "notice_persisted",
    })))
    const held: { readonly itemId: string; readonly entryId: string; readonly noticeId?: string }[] = []
    let flushed = 0
    for (const [itemId, content] of [["item-1", "first"], ["item-2", "second"]] as const) coordinator.enqueue({
      key: `goal:${itemId}`, itemId, source: "ulw-continuation", content, runRef: { kind: "dag", id: "run-1" },
      onHeld: receipt => { held.push({ itemId: receipt.itemId, entryId: receipt.entryId, noticeId: receipt.noticeId }) },
      onFlushed: () => { flushed += 1 },
    })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(sent.map(call => call.options)).toEqual([{ triggerTurn: true, deliverAs: "steer", items: [
      { itemId: "item-1", producer: "ulw-continuation", contentRange: [0, 5], runRef: { kind: "dag", id: "run-1" } },
      { itemId: "item-2", producer: "ulw-continuation", contentRange: [7, 13], runRef: { kind: "dag", id: "run-1" } },
    ] }])
    expect(held.map(receipt => [receipt.itemId, receipt.noticeId])).toEqual([["item-1", "notice:item-1"], ["item-2", "notice:item-2"]])
    expect(new Set(held.map(receipt => receipt.entryId))).toEqual(new Set(["held-batch"]))
    expect(flushed).toBe(0)
  })

  test("#given an open session #when an item is persisted as a message #then it is acknowledged as delivered", async () => {
    const { coordinator } = coordinatorOver(items => items.map(item => ({
      itemId: item.itemId, entryId: "entry-1", disposition: "message_persisted",
    })))
    let flushed = 0
    let held = 0
    coordinator.enqueue({ key: "st_1", itemId: "item-1", source: "task-completion", content: "done",
      onFlushed: () => { flushed += 1 }, onHeld: () => { held += 1 } })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(flushed).toBe(1)
    expect(held).toBe(0)
  })

  test("#given a receipt naming another item #when settled #then the item is reported undelivered, never assumed held", async () => {
    const { coordinator } = coordinatorOver(() => [{ itemId: "someone-else", entryId: "entry-x", disposition: "notice_persisted" }])
    const failures: unknown[] = []
    coordinator.enqueue({ key: "st_1", itemId: "item-1", source: "task-completion", content: "done",
      onDeliveryFailed: error => { failures.push(error) }, onFlushed: () => { throw new Error("must not flush") } })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(failures).toHaveLength(1)
  })
test("#given an engine without item custody #when it answers undefined #then the batch was delivered plainly", async () => {
    const { coordinator } = coordinatorOver(() => undefined)
    let flushed = 0
    coordinator.enqueue({ key: "st_1", itemId: "item-1", source: "task-completion", content: "done", onFlushed: () => { flushed += 1 } })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(flushed).toBe(1)
  })

  test("#given an engine with item custody #when it answers an empty receipt list #then every item is reported undelivered", async () => {
    const { coordinator } = coordinatorOver(() => [])
    const failures: unknown[] = []
    for (const itemId of ["item-1", "item-2"]) coordinator.enqueue({ key: itemId, itemId, source: "task-completion", content: itemId,
      onDeliveryFailed: error => { failures.push(error) }, onFlushed: () => { throw new Error("must not flush") } })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(failures).toHaveLength(2)
  })
})
