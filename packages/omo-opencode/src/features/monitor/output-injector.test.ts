import { describe, expect, test } from "bun:test"

import { MonitorOutputInjector } from "./output-injector"
import type { MonitorCounters, MonitorRecord, OutputBatch } from "./types"
import type { InternalPromptDispatchResult, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"

type DispatchCall = {
  source: string
  sessionID: string
  input: PromptAsyncInput
  queueBehavior?: string
  postDispatchHoldMs?: number
  checkStatus?: boolean
  checkToolState?: boolean
}

type FakeMessage = {
  info?: { role?: string; finish?: string; time?: { created?: unknown } }
  role?: string
  finish?: string
  time?: { created?: unknown }
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean; content?: unknown; state?: { status?: unknown } }>
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
    command: "printf secret",
    label: "build watcher",
    mode: "idle",
    parentSessionId: "parent-1",
    startedAt: new Date("2026-06-15T00:00:00.000Z"),
    status: "running",
    counters: baseCounters,
    ...overrides,
  }
}

function createBatch(batchSeq: number, text = `line-${batchSeq}`): OutputBatch {
  return {
    monitorId: "mon_1",
    batchSeq,
    lines: [{ stream: "stdout", seq: batchSeq, text }],
    stillRunning: true,
  }
}

function createHarness(opts: {
  active?: boolean
  messages?: FakeMessage[]
  dispatchResults?: InternalPromptDispatchResult[]
  now?: number
} = {}): {
  injector: MonitorOutputInjector
  calls: DispatchCall[]
  setActive(active: boolean): void
  setMessages(messages: FakeMessage[]): void
  client: PromptDispatchClient
} {
  let active = opts.active ?? false
  let messages = opts.messages ?? []
  const calls: DispatchCall[] = []
  const dispatchResults = [...opts.dispatchResults ?? []]
  const client = {
    session: {
      status: async () => ({ data: { "parent-1": { type: active ? "busy" : "idle" } } }),
      messages: async () => ({ data: messages }),
      promptAsync: async (_input: PromptAsyncInput) => ({ ok: true }),
    },
  } satisfies PromptDispatchClient & {
    session: {
      status: () => Promise<unknown>
      messages: (input: { path: { id: string }; query: { directory: string; limit?: number } }) => Promise<unknown>
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
    now: () => opts.now ?? 1_000,
    settleAfterSessionIdle: async () => {},
    dispatchInternalPrompt: async (args) => {
      calls.push({
        source: args.source,
        sessionID: args.sessionID,
        input: args.input,
        queueBehavior: args.queueBehavior,
        postDispatchHoldMs: args.postDispatchHoldMs,
        checkStatus: args.checkStatus,
        checkToolState: args.checkToolState,
      })
      return dispatchResults.shift() ?? { status: "dispatched", response: { ok: true } }
    },
    scheduleFlush: () => {},
  })

  return {
    injector,
    calls,
    client,
    setActive(nextActive: boolean): void {
      active = nextActive
    },
    setMessages(nextMessages: FakeMessage[]): void {
      messages = nextMessages
    },
  }
}

function latestUserMessage(createdAt: number, text = "real user prompt"): FakeMessage {
  return {
    role: "user",
    time: { created: createdAt },
    parts: [{ type: "text", text }],
  }
}

describe("MonitorOutputInjector", () => {
  describe("#given an idle-mode batch while the parent session is active", () => {
    test("#when flushing #then it does not dispatch and keeps the same batch pending", async () => {
      // given
      const record = createRecord({ mode: "idle" })
      const batch = createBatch(1)
      const { injector, calls } = createHarness({ active: true })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(0)
      expect(injector.getPendingBatches(record.id)).toEqual([batch])
      expect(injector.getPendingBatches(record.id)[0]).toBe(batch)
    })
  })

  describe("#given an active batch that later becomes idle", () => {
    test("#when flushing after idle #then it dispatches once with the monitor batch idempotency source", async () => {
      // given
      const record = createRecord({ mode: "idle" })
      const batch = createBatch(2)
      const harness = createHarness({ active: true })
      harness.injector.queueBatch(record, batch)
      await harness.injector.flushMonitor(record.id)
      harness.setActive(false)

      // when
      await harness.injector.flushMonitor(record.id)

      // then
      expect(harness.calls).toHaveLength(1)
      expect(harness.calls[0]?.source).toBe("monitor-output:mon_1:batch-2")
      expect(harness.calls[0]?.queueBehavior).toBe("defer")
      expect(harness.calls[0]?.postDispatchHoldMs).toBeGreaterThan(0)
      expect(harness.calls[0]?.checkStatus).toBe(true)
      expect(harness.calls[0]?.checkToolState).toBe(true)
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given the same batch sequence is queued twice", () => {
    test("#when flushing with a new sequence afterward #then duplicate seq collapses and new seq dispatches separately", async () => {
      // given
      const record = createRecord()
      const first = createBatch(3)
      const duplicate = createBatch(3, "duplicate")
      const second = createBatch(4)
      const { injector, calls } = createHarness()
      injector.queueBatch(record, first)
      await injector.flushMonitor(record.id)

      // when
      injector.queueBatch(record, duplicate)
      injector.queueBatch(record, second)
      await injector.flushMonitor(record.id)

      // then
      expect(calls.map((call) => call.source)).toEqual([
        "monitor-output:mon_1:batch-3",
        "monitor-output:mon_1:batch-4",
      ])
    })
  })

  describe("#given a real user message races the monitor flush", () => {
    test("#when the latest real user message is recent #then user wins and the monitor batch is requeued", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(5)
      const { injector, calls } = createHarness({ messages: [latestUserMessage(900)], now: 1_000 })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(0)
      expect(injector.getPendingBatches(record.id)[0]).toBe(batch)
    })
  })

  describe("#given live_safe mode while the parent session is active", () => {
    test("#when flushing #then it still defers instead of bypassing the active-session guard", async () => {
      // given
      const record = createRecord({ mode: "live_safe" })
      const batch = createBatch(6)
      const { injector, calls } = createHarness({ active: true })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(0)
      expect(injector.getPendingBatches(record.id)[0]).toBe(batch)
    })
  })

  describe("#given dispatch fails ambiguously after OpenCode may have accepted the message", () => {
    test("#when session history contains the accepted monitor message #then it does not double-inject", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(7)
      const acceptedText = "[OMO MONITOR OUTPUT]\nmonitor_id: mon_1\nbatch: 7\n<!-- OMO_INTERNAL_INITIATOR -->\n<!-- OMO_INTERNAL_NOREPLY -->"
      const { injector, calls } = createHarness({
        dispatchResults: [{ status: "failed", error: new Error("unexpected eof"), dispatchAttempted: true }],
        messages: [{ role: "user", time: { created: 1_000 }, parts: [{ type: "text", text: acceptedText }] }],
        now: 1_000,
      })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)
      injector.queueBatch(record, batch)
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(1)
      expect(injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given dev's prompt-async-gate blocks trailing non-no-reply internal user messages", () => {
    test("#when a batch dispatches #then the injected message text carries the internal no-reply marker", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(11)
      const { injector, calls } = createHarness({})
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(1)
      expect(JSON.stringify(calls[0]?.input ?? {})).toContain("OMO_INTERNAL_NOREPLY")
    })

    test("#when a prior no-reply monitor message is the latest history entry #then a fresh batch is NOT blocked", async () => {
      // given
      const record = createRecord()
      const priorNoReplyMonitorMessage = {
        role: "user",
        time: { created: 900 },
        parts: [{ type: "text", text: "[OMO MONITOR OUTPUT]\nmonitor_id: mon_1\nbatch: 1\n<!-- OMO_INTERNAL_INITIATOR -->\n<!-- OMO_INTERNAL_NOREPLY -->" }],
      }
      const batch = createBatch(12)
      const { injector, calls } = createHarness({ messages: [priorNoReplyMonitorMessage], now: 1_000 })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)

      // then
      expect(calls).toHaveLength(1)
    })
  })

  describe("#given the prompt gate returns a non-accepted result", () => {
    test("#when the same batch is retried after reservation #then the same batch object is requeued without changing sequence", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(8)
      const { injector, calls } = createHarness({
        dispatchResults: [
          { status: "reserved", reservedBy: "other-route" },
          { status: "dispatched", response: { ok: true } },
        ],
      })
      injector.queueBatch(record, batch)

      // when
      await injector.flushMonitor(record.id)
      const pendingAfterReserve = injector.getPendingBatches(record.id)[0]
      await injector.flushMonitor(record.id)

      // then
      expect(pendingAfterReserve).toBe(batch)
      expect(calls.map((call) => call.source)).toEqual([
        "monitor-output:mon_1:batch-8",
        "monitor-output:mon_1:batch-8",
      ])
    })
  })
})
