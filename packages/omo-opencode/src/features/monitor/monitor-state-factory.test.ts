import { describe, expect, test } from "bun:test"
import { MonitorBatcher } from "./batcher"
import { DEFAULT_MONITOR_CONFIG } from "./manager-internals"
import { createMonitorState } from "./monitor-state-factory"
import { MonitorRingBuffer } from "./ring-buffer"
import type { MonitorRecord, OutputBatch } from "./types"

function controlledStream() {
  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  const stream = new ReadableStream<Uint8Array>({
    start(next) {
      controller = next
    },
  })
  return { stream, write: (text: string) => controller?.enqueue(new TextEncoder().encode(text)) }
}

async function settle(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

describe("createMonitorState rate limit", () => {
  test("#given a monitor printing faster than the limit #when lines keep coming #then the excess is suppressed and counted on the next delivered batch", async () => {
    // given
    let now = 0
    const stdout = controlledStream()
    const queued: OutputBatch[] = []
    const record: MonitorRecord = {
      id: "mon_fast",
      command: "spam",
      label: "spam",
      mode: "idle",
      parentSessionId: "ses_p",
      startedAt: new Date(0),
      status: "running",
      eventsDelivered: 0,
      counters: {
        totalLines: 0,
        matchedLines: 0,
        unmatchedLines: 0,
        droppedMatched: 0,
        droppedUnmatched: 0,
        bytesDropped: 0,
        lastSequence: 0,
      },
    }
    const scheduler = { setTimer: () => 0, clearTimer: () => {}, now: () => now }
    createMonitorState({
      record,
      monitoredProcess: {
        kill() {},
        exited: new Promise(() => {}),
        stdout: stdout.stream,
        stderr: new ReadableStream(),
      },
      filter: { matches: () => true },
      ring: new MonitorRingBuffer({ ringMaxLines: 100 }),
      batcher: new MonitorBatcher({ batchMaxLines: 1, batchMaxBytes: 1_000, flushIntervalMs: 0, scheduler }),
      injector: { queueBatch: (_record, batch) => queued.push(batch), flushMonitor: async () => {} },
      config: DEFAULT_MONITOR_CONFIG,
      logger: () => {},
      now: () => now,
    })

    // when: 15 one-line batches at once, then one more after the refill interval
    stdout.write(Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n") + "\n")
    await settle()
    now = 2_000
    stdout.write("line 16\n")
    await settle()

    // then
    expect(queued).toHaveLength(11)
    expect(queued.slice(0, 10).every((batch) => batch.suppressedEvents === undefined)).toBe(true)
    expect(queued[10]?.lines.map((line) => line.text)).toEqual(["line 16"])
    expect(queued[10]?.suppressedEvents).toBe(5)
    expect(record.eventsDelivered).toBe(11)
  })
})
