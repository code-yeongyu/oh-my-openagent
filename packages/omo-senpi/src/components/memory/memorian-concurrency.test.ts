import { afterEach, describe, expect, test } from "bun:test"

const key = Symbol.for("omo.memorian.judgeSlots")

afterEach(() => {
  Reflect.deleteProperty(globalThis, key)
})

describe("memorian judge concurrency", () => {
  test("holds at most two judge slots and releases them", async () => {
    const module = await import("./memorian-concurrency")
    const first = module.tryAcquireJudgeSlot()
    const second = module.tryAcquireJudgeSlot()
    const third = module.tryAcquireJudgeSlot()

    expect(first).toBeFunction()
    expect(second).toBeFunction()
    expect(third).toBeUndefined()
    expect(module.judgeSlotsHeld()).toBe(2)

    first?.()
    expect(module.tryAcquireJudgeSlot()).toBeFunction()
    second?.()
    expect(module.judgeSlotsHeld()).toBe(1)
  })

  test("release is idempotent and never goes negative", async () => {
    const module = await import("./memorian-concurrency")
    const release = module.tryAcquireJudgeSlot()

    release?.()
    release?.()
    expect(module.judgeSlotsHeld()).toBe(0)
  })

  test("reports an empty ledger before acquiring", async () => {
    const module = await import("./memorian-concurrency")

    expect(module.judgeSlotsHeld()).toBe(0)
  })

  test("cap zero rejects every acquire", async () => {
    const module = await import("./memorian-concurrency")

    expect(module.tryAcquireJudgeSlot(0)).toBeUndefined()
    expect(module.judgeSlotsHeld()).toBe(0)
  })

  test("a second module instance shares the process-global count", async () => {
    const module = await import("./memorian-concurrency")
    const release = module.tryAcquireJudgeSlot()
    const second = await import(`./memorian-concurrency.ts?cacheBust=${Date.now()}`)

    expect(second.judgeSlotsHeld()).toBe(1)
    release?.()
    expect(second.judgeSlotsHeld()).toBe(0)
  })
})
