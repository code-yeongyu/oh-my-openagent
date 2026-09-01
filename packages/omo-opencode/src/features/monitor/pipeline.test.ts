/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { MonitorBatcher, type SchedulerDeps, type TimerHandle } from "./batcher"
import { createMonitorFilter } from "./filter"
import { LineStream } from "./line-stream"
import { createMonitorPipeline } from "./pipeline"
import { MonitorRingBuffer } from "./ring-buffer"
import type { OutputBatch } from "./types"

interface FakeTimer {
  id: number
  dueAt: number
  fn: () => void
}

interface FakeScheduler extends SchedulerDeps {
  activeTimerCount(): number
}

interface ControlledByteStream {
  stream: ReadableStream<Uint8Array>
  enqueueText(text: string): void
  close(): void
  error(error: unknown): void
  pullCount(): number
}

const encoder = new TextEncoder()

function createFakeScheduler(): FakeScheduler {
  let currentTime = 0
  let nextId = 1
  const timers = new Map<number, FakeTimer>()

  return {
    setTimer(fn: () => void, delayMs: number): TimerHandle {
      const id = nextId
      nextId += 1
      timers.set(id, { id, dueAt: currentTime + delayMs, fn })
      return id
    },
    clearTimer(handle: TimerHandle): void {
      if (typeof handle === "number") {
        timers.delete(handle)
      }
    },
    now(): number {
      return currentTime
    },
    activeTimerCount(): number {
      return timers.size
    },
  }
}

function createControlledByteStream(): ControlledByteStream {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let pulls = 0

  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController
    },
    pull() {
      pulls += 1
    },
  })

  function getController(): ReadableStreamDefaultController<Uint8Array> {
    if (!controller) {
      throw new Error("controlled stream was used before start")
    }

    return controller
  }

  return {
    stream,
    enqueueText(text: string): void {
      getController().enqueue(encoder.encode(text))
    },
    close(): void {
      getController().close()
    },
    error(error: unknown): void {
      getController().error(error)
    },
    pullCount(): number {
      return pulls
    },
  }
}

async function settleAsyncWork(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve()
  }
}

function createPipelineHarness(pattern = "") {
  const stdout = createControlledByteStream()
  const stderr = createControlledByteStream()
  const scheduler = createFakeScheduler()
  const batcher = new MonitorBatcher({
    batchMaxLines: 50,
    batchMaxBytes: 16_384,
    flushIntervalMs: 1000,
    scheduler,
  })
  const ring = new MonitorRingBuffer({ ringMaxLines: 1000 })
  const filterResult = createMonitorFilter(pattern, { patternMaxLength: 512 })
  if (!filterResult.filter) {
    throw new Error(filterResult.error ?? "filter construction failed")
  }

  const logs: unknown[] = []
  const batches: OutputBatch[] = []
  const pipeline = createMonitorPipeline(
    {
      lineStream: {
        stdout: new LineStream({ lineMaxBytes: 8192 }),
        stderr: new LineStream({ lineMaxBytes: 8192 }),
      },
      filter: filterResult.filter,
      ring,
      batcher,
    },
    {
      stdout: stdout.stream,
      stderr: stderr.stream,
      log: (error) => logs.push(error),
    },
  )
  pipeline.onBatch((batch) => batches.push(batch))

  return { stdout, stderr, scheduler, ring, logs, batches, pipeline }
}

describe("createMonitorPipeline", () => {
  describe("#given stdout and stderr streams", () => {
    test("#when the pipeline starts #then both streams are read concurrently before either stream ends", async () => {
      // given
      const harness = createPipelineHarness()

      // when
      await settleAsyncWork()

      // then
      expect(harness.stdout.pullCount()).toBeGreaterThan(0)
      expect(harness.stderr.pullCount()).toBeGreaterThan(0)

      harness.pipeline.stop()
    })
  })

  describe("#given interleaved stdout and stderr lines", () => {
    test("#when both streams close #then lines receive stream tags and shared monotonic sequences", async () => {
      // given
      const harness = createPipelineHarness()

      // when
      harness.stdout.enqueueText("out-1\n")
      await settleAsyncWork()
      harness.stderr.enqueueText("err-1\n")
      await settleAsyncWork()
      harness.stdout.enqueueText("out-2\n")
      harness.stdout.close()
      harness.stderr.close()
      await settleAsyncWork()

      // then
      const allLines = harness.ring.query({ stream: "all" }).lines
      expect(allLines).toEqual([
        { stream: "stdout", seq: 1, text: "out-1" },
        { stream: "stderr", seq: 2, text: "err-1" },
        { stream: "stdout", seq: 3, text: "out-2" },
      ])
      expect(harness.pipeline.counters().lastSequence).toBe(3)
    })
  })

  describe("#given an ERROR filter", () => {
    test("#when matched and unmatched lines arrive #then only matched lines batch and unmatched lines stay in the ring", async () => {
      // given
      const harness = createPipelineHarness("ERROR")

      // when
      harness.stdout.enqueueText("INFO boot\nERROR boom\n")
      harness.stderr.enqueueText("WARN ignored\nERROR stderr\n")
      harness.stdout.close()
      harness.stderr.close()
      await settleAsyncWork()

      // then
      expect(harness.batches).toHaveLength(1)
      expect(harness.batches[0]?.lines.map((line) => line.text)).toEqual(["ERROR boom", "ERROR stderr"])
      expect(harness.ring.query({ stream: "unmatched" }).lines.map((line) => line.text)).toEqual([
        "INFO boot",
        "WARN ignored",
      ])
      expect(harness.pipeline.counters()).toMatchObject({
        totalLines: 4,
        matchedLines: 2,
        unmatchedLines: 2,
      })
      expect(harness.scheduler.activeTimerCount()).toBe(0)
    })
  })

  describe("#given a partial matched batch", () => {
    test("#when streams end #then the pipeline flushes the final batch without fake time advancing", async () => {
      // given
      const harness = createPipelineHarness("ERROR")

      // when
      harness.stdout.enqueueText("ERROR final")
      harness.stdout.close()
      harness.stderr.close()
      await settleAsyncWork()

      // then
      expect(harness.batches).toHaveLength(1)
      expect(harness.batches[0]?.lines).toEqual([{ stream: "stdout", seq: 1, text: "ERROR final" }])
    })
  })

  describe("#given one stream read fails", () => {
    test("#when the read loop rejects #then the error is logged and later output is ignored after the pipeline stops", async () => {
      // given
      const harness = createPipelineHarness("ERROR")
      const readError = new Error("stdout exploded")

      // when
      harness.stdout.error(readError)
      await settleAsyncWork()

      // then
      expect(harness.logs).toEqual([readError])
      expect(harness.pipeline.isStopped()).toBe(true)
      expect(harness.pipeline.counters().totalLines).toBe(0)
      expect(harness.batches).toEqual([])
    })
  })
})
