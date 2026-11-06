import { describe, expect, test } from "bun:test"
import { IdleInjectionCoordinator } from "./idle-injection-coordinator"
import { deliverItems } from "./deliver-items"

describe("native itemized run admission", () => {
  test("#given a formed coordinator batch #when the engine fences one run #then one send carries one item per key and every enqueue gets its receipt", async () => {
    const sends: { readonly content: string; readonly items: readonly { readonly itemId: string; readonly runRef?: unknown }[] }[] = []
    let held = 0
    let delivered = 0
    const finished = Promise.withResolvers<void>()
    const settle = () => { if (held + delivered === 3) finished.resolve() }
    const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems((native, delivery) => {
      sends.push({ content: native.content, items: delivery.items })
      return delivery.items.map(item => (item.runRef as { id?: string } | undefined)?.id === "fenced"
        ? { itemId: item.itemId, entryId: "held-batch", noticeId: `notice:${item.itemId}`, disposition: "notice_persisted" as const }
        : { itemId: item.itemId, entryId: `entry:${item.itemId}`, disposition: "message_persisted" as const })
    }, { ...options, message }))
    for (const content of ["first", "second"]) coordinator.enqueue({
      key: "same-key", source: "task-completion", content, runRef: { kind: "task", id: "fenced" },
      onHeld: () => { held += 1; settle() }, onFlushed: () => { delivered += 1; settle() },
    })
    coordinator.enqueue({ key: "unrelated", source: "ulw-continuation", content: "unrelated work",
      onFlushed: () => { delivered += 1; settle() } })
    coordinator.flushOnIdle()
    await finished.promise
    expect(sends).toHaveLength(1)
    expect(sends[0]?.content).toBe("second\n\nunrelated work")
    expect(sends[0]?.items.map(item => item.runRef)).toEqual([{ kind: "task", id: "fenced" }, undefined])
    expect(new Set(sends[0]?.items.map(item => item.itemId)).size).toBe(2)
    expect(held).toBe(2)
    expect(delivered).toBe(1)
  })

  test("#given an engine that predates items #when a batch is sent #then it answers nothing and every item is delivered", async () => {
    let delivered = 0
    const coordinator = new IdleInjectionCoordinator((message, options) => deliverItems(() => undefined, { ...options, message }))
    for (const key of ["a", "b"]) coordinator.enqueue({ key, source: "task-completion", content: key, onFlushed: () => { delivered += 1 } })
    coordinator.flushOnIdle()
    await Promise.resolve()
    await Promise.resolve()
    expect(delivered).toBe(2)
  })
})
