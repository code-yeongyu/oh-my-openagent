import { describe, expect, test } from "bun:test"

import { MonitorBatcher, type SchedulerDeps, type TimerHandle } from "./batcher"
import type { OutputBatch, OutputLine } from "./types"

interface FakeTimer {
  id: number
  dueAt: number
  fn: () => void
  cleared: boolean
}

function createFakeScheduler(): SchedulerDeps & { advanceBy(delayMs: number): void; activeTimerCount(): number } {
  let currentTime = 0
  let nextId = 1
  const timers = new Map<number, FakeTimer>()

  return {
    setTimer(fn: () => void, delayMs: number): TimerHandle {
      const id = nextId++
      timers.set(id, { id, dueAt: currentTime + delayMs, fn, cleared: false })
      return id
    },
    clearTimer(handle: TimerHandle): void {
      if (typeof handle !== "number") {
        return
      }

      const timer = timers.get(handle)
      if (timer) {
        timer.cleared = true
        timers.delete(handle)
      }
    },
    now(): number {
      return currentTime
    },
    advanceBy(delayMs: number): void {
      const targetTime = currentTime + delayMs

      while (true) {
        const nextTimer = [...timers.values()]
          .filter((timer) => !timer.cleared && timer.dueAt <= targetTime)
          .sort((left, right) => left.dueAt - right.dueAt || left.id - right.id)[0]

        if (!nextTimer) {
          break
        }

        currentTime = nextTimer.dueAt
        timers.delete(nextTimer.id)
        nextTimer.fn()
      }

      currentTime = targetTime
    },
    activeTimerCount(): number {
      return timers.size
    },
  }
}

function createLine(seq: number, text = `line-${seq}`): OutputLine {
  return { stream: "stdout", seq, text }
}

function createBatcher(
  scheduler: SchedulerDeps,
  overrides: Partial<ConstructorParameters<typeof MonitorBatcher>[0]> = {},
): MonitorBatcher {
  return new MonitorBatcher({
    batchMaxLines: 3,
    batchMaxBytes: 100,
    flushIntervalMs: 1000,
    scheduler,
    ...overrides,
  })
}

describe("MonitorBatcher", () => {
  describe("#given a line-count threshold", () => {
    test("#when pushing batchMaxLines lines #then it emits one batch immediately and clears the timer", () => {
      // given
      const scheduler = createFakeScheduler()
      const batcher = createBatcher(scheduler, { batchMaxLines: 3 })
      const batches: OutputBatch[] = []
      batcher.onBatch((batch) => batches.push(batch))

      // when
      batcher.push(createLine(1))
      batcher.push(createLine(2))
      batcher.push(createLine(3))

      // then
      expect(batches).toHaveLength(1)
      expect(batches[0]).toEqual({
        monitorId: "",
        batchSeq: 1,
        lines: [createLine(1), createLine(2), createLine(3)],
        stillRunning: true,
      })
      expect(batcher.pendingCount()).toBe(0)
      expect(scheduler.activeTimerCount()).toBe(0)
    })
  })

  describe("#given a partial pending batch", () => {
    test("#when fake time reaches flushIntervalMs #then it flushes without real timers", () => {
      // given
      const scheduler = createFakeScheduler()
      const batcher = createBatcher(scheduler, { flushIntervalMs: 1000 })
      const batches: OutputBatch[] = []
      batcher.onBatch((batch) => batches.push(batch))

      // when
      batcher.push(createLine(1))
      scheduler.advanceBy(999)
      const beforeInterval = batches.length
      scheduler.advanceBy(1)

      // then
      expect(beforeInterval).toBe(0)
      expect(batches).toHaveLength(1)
      expect(batches[0]?.lines).toEqual([createLine(1)])
      expect(scheduler.activeTimerCount()).toBe(0)
    })
  })

  describe("#given a byte threshold", () => {
    test("#when pushed line text lengths sum to batchMaxBytes #then it flushes early", () => {
      // given
      const scheduler = createFakeScheduler()
      const batcher = createBatcher(scheduler, { batchMaxBytes: 10 })
      const batches: OutputBatch[] = []
      batcher.onBatch((batch) => batches.push(batch))

      // when
      batcher.push(createLine(1, "abcd"))
      batcher.push(createLine(2, "efghij"))

      // then
      expect(batches).toHaveLength(1)
      expect(batches[0]?.lines).toEqual([createLine(1, "abcd"), createLine(2, "efghij")])
      expect(scheduler.activeTimerCount()).toBe(0)
    })
  })

  describe("#given multiple flush triggers", () => {
    test("#when flushing three batches #then batchSeq increments without gaps", () => {
      // given
      const scheduler = createFakeScheduler()
      const batcher = createBatcher(scheduler, { batchMaxLines: 2, batchMaxBytes: 100 })
      const batches: OutputBatch[] = []
      batcher.onBatch((batch) => batches.push(batch))

      // when
      batcher.push(createLine(1))
      batcher.push(createLine(2))
      batcher.push(createLine(3))
      batcher.flushNow()
      batcher.push(createLine(4))
      scheduler.advanceBy(1000)

      // then
      expect(batches.map((batch) => batch.batchSeq)).toEqual([1, 2, 3])
      expect(batches.map((batch) => batch.lines.map((line) => line.seq))).toEqual([[1, 2], [3], [4]])
    })
  })

  describe("#given 10000 rapid lines", () => {
    test("#when line threshold coalesces output #then it emits far fewer batches than lines", () => {
      // given
      const scheduler = createFakeScheduler()
      const batcher = createBatcher(scheduler, { batchMaxLines: 50, batchMaxBytes: 1_000_000 })
      const batches: OutputBatch[] = []
      batcher.onBatch((batch) => batches.push(batch))

      // when
      for (let seq = 1; seq <= 10_000; seq += 1) {
        batcher.push(createLine(seq, "x"))
      }

      // then
      expect(batches).toHaveLength(200)
      expect(batches.length).toBeLessThan(10_000)
      expect(batcher.pendingCount()).toBe(0)
    })
  })
})
