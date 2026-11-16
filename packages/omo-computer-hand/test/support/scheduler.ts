import type { Scheduler } from "../../src/index.ts"

interface Timer {
  at: number
  readonly period: number | null
  readonly fn: () => void
  live: boolean
}

/** A scheduler on a fake clock: `advance` fires every due timer in time order. */
export class FakeScheduler implements Scheduler {
  #now = 0
  #timers: Timer[] = []

  now(): number {
    return this.#now
  }

  every(ms: number, fn: () => void): () => void {
    return this.#add({ at: this.#now + ms, period: ms, fn, live: true })
  }

  after(ms: number, fn: () => void): () => void {
    return this.#add({ at: this.#now + ms, period: null, fn, live: true })
  }

  /** Moves the clock forward, firing timers in order and letting promise callbacks run between them. */
  async advance(ms: number): Promise<void> {
    const end = this.#now + ms
    for (;;) {
      const next = this.#timers.filter((timer) => timer.live && timer.at <= end).sort((a, b) => a.at - b.at)[0]
      if (next === undefined) break
      this.#now = next.at
      if (next.period === null) next.live = false
      else next.at += next.period
      next.fn()
      for (let i = 0; i < 10; i++) await Promise.resolve()
    }
    this.#now = end
  }

  #add(timer: Timer): () => void {
    this.#timers.push(timer)
    return () => {
      timer.live = false
    }
  }
}
