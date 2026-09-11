import { describe, expect, test } from "bun:test"

import { hasInternalNoReplyMarker } from "../../shared"
import { MonitorBatcher } from "./batcher"
import { MonitorOutputInjector } from "./output-injector"
import type { InternalPromptDispatchResult, PromptAsyncInput, PromptDispatchClient } from "@oh-my-opencode/utils/prompt-async-gate/types"
import type { MonitorCounters, MonitorRecord, OutputBatch } from "./types"

type DispatchCall = {
  source: string
  input: PromptAsyncInput
  checkStatus?: boolean
}

const baseCounters = {
  totalLines: 1,
  matchedLines: 1,
  unmatchedLines: 0,
  droppedMatched: 0,
  droppedUnmatched: 0,
  bytesDropped: 0,
  lastSequence: 1,
} satisfies MonitorCounters

function createRecord(overrides: Partial<MonitorRecord> = {}): MonitorRecord {
  return {
    id: "mon_1",
    command: "make build",
    label: "build watcher",
    mode: "idle",
    parentSessionId: "parent-1",
    startedAt: new Date("2026-08-02T16:00:00.000Z"),
    status: "exited",
    exitCode: 1,
    counters: baseCounters,
    ...overrides,
  }
}

function createBatch(batchSeq: number, stillRunning: boolean): OutputBatch {
  return {
    monitorId: "mon_1",
    batchSeq,
    lines: [{ stream: "stderr", seq: batchSeq, text: "build failed" }],
    stillRunning,
  }
}

function createHarness(opts: {
  active?: boolean
  maxActiveDeferMs?: number
} = {}): {
  injector: MonitorOutputInjector
  calls: DispatchCall[]
  advance(ms: number): void
} {
  const active = opts.active ?? false
  const calls: DispatchCall[] = []
  let currentTime = 1_000

  const client = {
    session: {
      status: async () => ({ data: { "parent-1": { type: active ? "busy" : "idle" } } }),
      messages: async () => ({ data: [] }),
      promptAsync: async (_input: PromptAsyncInput) => ({ ok: true }),
    },
  } satisfies PromptDispatchClient & {
    session: {
      status: () => Promise<unknown>
      messages: (input: { path: { id: string }; query: { directory: string } }) => Promise<unknown>
      promptAsync: (input: PromptAsyncInput) => Promise<unknown>
    }
  }

  const injector = new MonitorOutputInjector({
    client,
    directory: "/repo",
    pendingRetryMs: 25,
    acceptedMessageSkewMs: 50,
    userMessageInProgressWindowMs: 500,
    postDispatchHoldMs: 250,
    ...(opts.maxActiveDeferMs === undefined ? {} : { maxActiveDeferMs: opts.maxActiveDeferMs }),
    now: () => currentTime,
    settleAfterSessionIdle: async () => {},
    dispatchInternalPrompt: async (args): Promise<InternalPromptDispatchResult> => {
      calls.push({ source: args.source, input: args.input, checkStatus: args.checkStatus })
      return { status: "dispatched", response: { ok: true } }
    },
    scheduleFlush: () => {},
  })

  return {
    injector,
    calls,
    advance(ms: number): void {
      currentTime += ms
    },
  }
}

function firstPartText(call: DispatchCall): string {
  const part = call.input.body.parts?.[0] as { text?: string } | undefined
  return part?.text ?? ""
}

describe("monitor terminal batch parent wake", () => {
  test("terminal batch dispatches as a reply-producing prompt", async () => {
    const harness = createHarness()

    harness.injector.queueBatch(createRecord(), createBatch(1, false))
    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.input.body.noReply).toBe(false)
    expect(hasInternalNoReplyMarker(firstPartText(harness.calls[0] as DispatchCall))).toBe(false)
  })

  test("streaming batch stays a no-reply observation", async () => {
    const harness = createHarness()

    harness.injector.queueBatch(createRecord({ status: "running", exitCode: undefined }), createBatch(1, true))
    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.input.body.noReply).toBe(true)
    expect(hasInternalNoReplyMarker(firstPartText(harness.calls[0] as DispatchCall))).toBe(true)
  })

  test("terminal batch over the active defer ceiling dispatches while the parent is busy", async () => {
    const harness = createHarness({ active: true, maxActiveDeferMs: 60_000 })

    harness.injector.queueBatch(createRecord(), createBatch(1, false))
    await harness.injector.flushMonitor("mon_1")
    expect(harness.calls).toHaveLength(0)

    harness.advance(60_000)
    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.input.body.noReply).toBe(false)
    expect(harness.calls[0]?.checkStatus).toBe(false)
  })

  test("streaming batch is never force dispatched while the parent is busy", async () => {
    const harness = createHarness({ active: true, maxActiveDeferMs: 60_000 })

    harness.injector.queueBatch(createRecord({ status: "running", exitCode: undefined }), createBatch(1, true))
    harness.advance(600_000)
    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(0)
  })

  test("over-ceiling terminal batch dispatches ahead of queued streaming batches while the parent is busy", async () => {
    const harness = createHarness({ active: true, maxActiveDeferMs: 60_000 })
    const runningRecord = createRecord({ status: "running", exitCode: undefined })

    harness.injector.queueBatch(runningRecord, createBatch(1, true))
    harness.injector.queueBatch(runningRecord, createBatch(2, true))
    harness.injector.queueBatch(createRecord(), createBatch(3, false))
    harness.advance(60_000)

    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(1)
    expect(harness.calls[0]?.source).toBe("monitor-output:mon_1:batch-3")
    expect(harness.calls[0]?.input.body.noReply).toBe(false)
    expect(harness.calls[0]?.checkStatus).toBe(false)
    expect(harness.injector.getPendingBatches("mon_1").map((batch) => batch.batchSeq)).toEqual([1, 2])
  })

  test("ceiling is opt-in: an omitted maxActiveDeferMs keeps the unbounded legacy deferral", async () => {
    const harness = createHarness({ active: true })

    harness.injector.queueBatch(createRecord(), createBatch(1, false))
    harness.advance(600_000)
    await harness.injector.flushMonitor("mon_1")

    expect(harness.calls).toHaveLength(0)
  })
})

describe("terminal batch is produced even when the buffer is already drained", () => {
  function createBatcher(): { batcher: MonitorBatcher; batches: OutputBatch[] } {
    const batches: OutputBatch[] = []
    const batcher = new MonitorBatcher({ batchMaxLines: 50, batchMaxBytes: 16384, flushIntervalMs: 0 })
    batcher.onBatch((batch) => {
      batches.push(batch)
    })
    return { batcher, batches }
  }

  test("an empty buffer stays silent by default", () => {
    const { batcher, batches } = createBatcher()

    batcher.flushNow()

    expect(batches).toHaveLength(0)
  })

  test("allowEmpty emits a zero-line batch so the exit envelope still reaches the parent", () => {
    const { batcher, batches } = createBatcher()

    batcher.flushNow({ allowEmpty: true })

    expect(batches).toHaveLength(1)
    expect(batches[0]?.lines).toHaveLength(0)
    expect(batches[0]?.batchSeq).toBe(1)
  })

  test("allowEmpty after a drained buffer keeps batchSeq monotonic", () => {
    const { batcher, batches } = createBatcher()

    batcher.push({ stream: "stdout", seq: 1, text: "QA_BUILD_LINE" })
    batcher.flushNow()
    batcher.flushNow({ allowEmpty: true })

    expect(batches.map((b) => b.batchSeq)).toEqual([1, 2])
    expect(batches[0]?.lines).toHaveLength(1)
    expect(batches[1]?.lines).toHaveLength(0)
  })
})
