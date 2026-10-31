import { describe, expect, test } from "bun:test"
import { type ApprovalAnswer, type ApprovalClock, createApprovalCache, isEntryValid } from "./approval-cache"

function fakeClock(start: number) {
  let now = start
  const slept: number[] = []
  const clock: ApprovalClock = {
    nowSeconds: () => now,
    sleepMs: async ms => {
      slept.push(ms)
      now += ms / 1_000
    },
  }
  return { clock, slept, set: (value: number) => (now = value) }
}

const approved = (value: string, cdat: number, mdat: number): ApprovalAnswer => ({ kind: "approved", value, attributes: { cdat, mdat } })

describe("approval cache validity (#11262 design 3.5)", () => {
  const entry = { value: "v", cdat: 100, mdat: 200, readStartedAt: 300.5 }

  test("#given the same item #when it is consumed #then the entry is valid", () => {
    expect(isEntryValid(entry, { cdat: 100, mdat: 200 }, 301)).toBe(true)
  })

  test.each([
    ["a write moved mdat", { cdat: 100, mdat: 301 }, 302],
    ["the item was re-created", { cdat: 150, mdat: 200 }, 302],
    ["a write landed in the approval's own second", { cdat: 100, mdat: 300 }, 302],
    ["the clock went backwards", { cdat: 100, mdat: 200 }, 299],
  ] as const)("#given %s #when consumed #then the entry is invalid", (_name, current, now) => {
    expect(isEntryValid(entry, current, now)).toBe(false)
  })
})

describe("process approval cache (#11262 3.2 steps 3-4, addendum rows 12, 13, 22, 23)", () => {
  test("#given concurrent callers #when they need approval #then one approve runs and all attach to it", async () => {
    const { clock } = fakeClock(1_000)
    const cache = createApprovalCache(clock)
    let runs = 0
    let answer!: (value: ApprovalAnswer) => void
    const run = () => {
      runs++
      return new Promise<ApprovalAnswer>(resolve => {
        answer = resolve
      })
    }
    const first = cache.approve(run)
    const second = cache.approve(run)
    answer(approved("token", 10, 20))
    expect(await first).toEqual(await second)
    expect(runs).toBe(1)
    expect(cache.consume({ cdat: 10, mdat: 20 })).toBe("token")
  })

  test("#given an answer that arrives after a caller gave up #when the next caller reads #then it is served without a second approve", async () => {
    const { clock } = fakeClock(1_000)
    const cache = createApprovalCache(clock)
    let answer!: (value: ApprovalAnswer) => void
    const abandoned = cache.approve(() => new Promise<ApprovalAnswer>(resolve => (answer = resolve)))
    answer(approved("late", 10, 20))
    await abandoned
    let runs = 0
    expect(cache.consume({ cdat: 10, mdat: 20 })).toBe("late")
    await cache.approve(async () => {
      runs++
      return approved("x", 1, 1)
    })
    expect(runs).toBe(1)
  })

  test("#given a Deny #when background paths ask #then the denial is remembered; an approval later clears it", async () => {
    const cache = createApprovalCache(fakeClock(1_000).clock)
    await cache.approve(async () => ({ kind: "denied" }))
    expect(cache.deniedForBackground()).toBe(true)
    expect(cache.consume({ cdat: 1, mdat: 1 })).toBeNull()
    await cache.approve(async () => approved("ok", 1, 2))
    expect(cache.deniedForBackground()).toBe(false)
  })

  test("#given this process's own write #when the hold ends #then the entry keeps serving, and a later foreign write drops it", async () => {
    const time = fakeClock(1_000.2)
    const cache = createApprovalCache(time.clock)
    await cache.approve(async () => approved("old", 10, 20))
    let attributes = { cdat: 10, mdat: 1_000 }
    await cache.afterOwnWrite("refreshed", async () => attributes)
    expect(time.slept.length).toBeGreaterThan(0)
    expect(Math.floor(time.clock.nowSeconds())).toBeGreaterThan(1_000)
    expect(cache.consume(attributes)).toBe("refreshed")
    attributes = { cdat: 10, mdat: Math.floor(time.clock.nowSeconds()) }
    expect(cache.consume(attributes)).toBeNull()
  })
})
