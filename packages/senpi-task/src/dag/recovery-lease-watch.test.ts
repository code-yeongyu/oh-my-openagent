import { describe, expect, test } from "bun:test"

import { createDagLeaseWatch, type DagLeaseWatchTimers } from "./recovery-lease-watch"

class ManualTimers implements DagLeaseWatchTimers {
  readonly #timers = new Map<number, { readonly callback: () => void; readonly ms: number }>()
  #next = 0

  set(callback: () => void, ms: number): number {
    this.#next += 1
    this.#timers.set(this.#next, { callback, ms })
    return this.#next
  }

  clear(handle: ReturnType<typeof setTimeout> | number): void {
    if (typeof handle === "number") this.#timers.delete(handle)
  }

  pending(): number {
    return this.#timers.size
  }

  tick(): void {
    const due = [...this.#timers]
    this.#timers.clear()
    for (const [, timer] of due) timer.callback()
  }
}

describe("DAG lease watch", () => {
  test("#given a live holder pid #when the holder exits between polls #then the exit callback fires exactly once and polling stops", () => {
    // given
    const timers = new ManualTimers()
    let alive = true
    const watch = createDagLeaseWatch({ isProcessAlive: () => alive, timers, intervalMs: 250 })
    let fired = 0
    watch.watch(4242, () => {
      fired += 1
    })

    // when the holder is still alive on the first poll
    timers.tick()

    // then the watch keeps polling without firing
    expect(fired).toBe(0)
    expect(timers.pending()).toBe(1)

    // when the holder exits before the next poll
    alive = false
    timers.tick()
    timers.tick()

    // then
    expect(fired).toBe(1)
    expect(timers.pending()).toBe(0)
  })

  test("#given an armed watch #when the caller cancels it before the holder exits #then the callback never fires and no timer stays pending", () => {
    // given
    const timers = new ManualTimers()
    let alive = true
    const watch = createDagLeaseWatch({ isProcessAlive: () => alive, timers, intervalMs: 250 })
    let fired = 0
    const cancel = watch.watch(4242, () => {
      fired += 1
    })

    // when
    cancel()
    alive = false
    timers.tick()

    // then
    expect(fired).toBe(0)
    expect(timers.pending()).toBe(0)
  })

  test("#given several armed watches #when the watch is disposed #then every pending poll is cleared and nothing fires afterwards", () => {
    // given
    const timers = new ManualTimers()
    const watch = createDagLeaseWatch({ isProcessAlive: () => false, timers, intervalMs: 250 })
    let fired = 0
    watch.watch(1, () => {
      fired += 1
    })
    watch.watch(2, () => {
      fired += 1
    })
    expect(timers.pending()).toBe(2)

    // when
    watch.dispose()
    timers.tick()

    // then
    expect(fired).toBe(0)
    expect(timers.pending()).toBe(0)
  })

  test("#given the default timers #when a holder pid that cannot exist is watched #then the callback fires through the real timer path", async () => {
    // given - 2_147_483_647 is above every reachable pid, so the default probe reports it dead
    const watch = createDagLeaseWatch({ intervalMs: 1 })
    const exited = new Promise<void>((resolve) => {
      watch.watch(2_147_483_647, resolve)
    })
    const budget = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error("lease watch did not fire within 2s")), 2_000)
    })

    // when / then
    await Promise.race([exited, budget])
    watch.dispose()
  })
})
