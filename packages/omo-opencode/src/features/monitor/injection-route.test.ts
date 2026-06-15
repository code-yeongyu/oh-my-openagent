import { describe, expect, test } from "bun:test"

import { MonitorOutputInjector } from "./output-injector"
import type { MonitorCounters, MonitorRecord, OutputBatch } from "./types"
import type { InternalPromptDispatchArgs, InternalPromptDispatchResult, PromptAsyncInput, PromptDispatchClient } from "../../shared/prompt-async-gate/types"

type DispatchCall = {
  source: string
  sessionID: string
  queueBehavior?: string
  postDispatchHoldMs?: number
  checkStatus?: boolean
  checkToolState?: boolean
  input: PromptAsyncInput
}

type FakeMessage = {
  role?: string
  time?: { created?: unknown }
  parts?: Array<{ type?: string; text?: string; synthetic?: boolean; content?: unknown; state?: { status?: unknown } }>
}

type ScheduledFlush = {
  monitorId: string
  delayMs: number
  operation: () => Promise<void>
}

type Harness = {
  injector: MonitorOutputInjector
  calls: DispatchCall[]
  scheduledFlushes: ScheduledFlush[]
  setActive(active: boolean): void
  setMessages(messages: FakeMessage[]): void
}

const counters = {
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
    id: "mon_route",
    command: "bun test --watch",
    label: "route regression monitor",
    mode: "idle",
    parentSessionId: "parent-route",
    startedAt: new Date("2026-06-15T00:00:00.000Z"),
    status: "running",
    counters,
    ...overrides,
  }
}

function createBatch(batchSeq: number, text = `matched-${batchSeq}`): OutputBatch {
  return {
    monitorId: "mon_route",
    batchSeq,
    lines: [{ stream: "stdout", seq: batchSeq, text }],
    stillRunning: true,
  }
}

function createRecentUserMessage(createdAt: number): FakeMessage {
  return {
    role: "user",
    time: { created: createdAt },
    parts: [{ type: "text", text: "real user message" }],
  }
}

function createHarness(opts: {
  active?: boolean
  messages?: FakeMessage[]
  now?: number
  dispatchResults?: InternalPromptDispatchResult[]
  dispatchFn?: (args: InternalPromptDispatchArgs<PromptAsyncInput>) => Promise<InternalPromptDispatchResult>
} = {}): Harness {
  let active = opts.active ?? false
  let messages = opts.messages ?? []
  const calls: DispatchCall[] = []
  const scheduledFlushes: ScheduledFlush[] = []
  const dispatchResults = [...opts.dispatchResults ?? []]
  const client = {
    session: {
      status: async () => ({ data: { "parent-route": { type: active ? "busy" : "idle" } } }),
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
        queueBehavior: args.queueBehavior,
        postDispatchHoldMs: args.postDispatchHoldMs,
        checkStatus: args.checkStatus,
        checkToolState: args.checkToolState,
        input: args.input,
      })
      if (opts.dispatchFn) {
        return opts.dispatchFn(args)
      }
      return dispatchResults.shift() ?? { status: "dispatched", response: { ok: true } }
    },
    scheduleFlush: (monitorId, delayMs, operation) => {
      scheduledFlushes.push({ monitorId, delayMs, operation })
    },
  })

  return {
    injector,
    calls,
    scheduledFlushes,
    setActive(nextActive: boolean): void {
      active = nextActive
    },
    setMessages(nextMessages: FakeMessage[]): void {
      messages = nextMessages
    },
  }
}

function createDeferredDispatch(): {
  promise: Promise<InternalPromptDispatchResult>
  resolve(value: InternalPromptDispatchResult): void
} {
  let resolveDispatch: ((value: InternalPromptDispatchResult) => void) | undefined
  const promise = new Promise<InternalPromptDispatchResult>((resolve) => {
    resolveDispatch = resolve
  })
  return {
    promise,
    resolve(value): void {
      if (!resolveDispatch) {
        throw new Error("dispatch promise was not initialized")
      }
      resolveDispatch(value)
    },
  }
}

async function drainMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("MonitorOutputInjector injection route", () => {
  describe("#given output is produced while the parent session is active", () => {
    test("#when the session later becomes idle #then dispatch is deferred and then delivered exactly once", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(1)
      const harness = createHarness({ active: true })
      harness.injector.queueBatch(record, batch)

      // when
      await harness.injector.flushMonitor(record.id)
      harness.setActive(false)
      await harness.scheduledFlushes[0]?.operation()

      // then
      expect(harness.calls).toHaveLength(1)
      expect(harness.calls[0]?.source).toBe("monitor-output:mon_route:batch-1")
      expect(harness.scheduledFlushes).toHaveLength(2)
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given an idle parent session and a pending monitor batch", () => {
    test("#when the route flushes #then it dispatches once with required prompt gate options", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(2)
      const harness = createHarness()
      harness.injector.queueBatch(record, batch)

      // when
      await harness.injector.flushMonitor(record.id)
      harness.injector.queueBatch(record, batch)
      await harness.injector.flushMonitor(record.id)

      // then
      expect(harness.calls).toHaveLength(1)
      expect(harness.calls[0]).toMatchObject({
        source: "monitor-output:mon_route:batch-2",
        sessionID: "parent-route",
        queueBehavior: "defer",
        postDispatchHoldMs: 250,
        checkStatus: true,
        checkToolState: true,
      })
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given two concurrent flushes target the same batch sequence", () => {
    test("#when dispatch is still in flight #then the same source is sent through the route once", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(3)
      const deferred = createDeferredDispatch()
      const harness = createHarness({ dispatchFn: async () => deferred.promise })
      harness.injector.queueBatch(record, batch)

      // when
      const firstFlush = harness.injector.flushMonitor(record.id)
      const secondFlush = harness.injector.flushMonitor(record.id)
      await drainMicrotasks()
      deferred.resolve({ status: "dispatched", response: { ok: true } })
      await Promise.all([firstFlush, secondFlush])

      // then
      expect(harness.calls.map((call) => call.source)).toEqual(["monitor-output:mon_route:batch-3"])
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given a session error arrives after a monitor dispatch attempt", () => {
    test("#when the same batch is requeued #then delivered source tracking prevents a second injection", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(4)
      const harness = createHarness()
      harness.injector.queueBatch(record, batch)
      await harness.injector.flushMonitor(record.id)

      // when
      harness.injector.queueBatch(record, batch)
      await harness.injector.flushMonitor(record.id)

      // then
      expect(harness.calls.map((call) => call.source)).toEqual(["monitor-output:mon_route:batch-4"])
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given a real user message races a pending monitor batch", () => {
    test("#when the user message is still fresh #then user ordering wins until the next idle flush", async () => {
      // given
      const record = createRecord()
      const batch = createBatch(5)
      const harness = createHarness({ messages: [createRecentUserMessage(900)], now: 1_000 })
      harness.injector.queueBatch(record, batch)

      // when
      await harness.injector.flushMonitor(record.id)
      harness.setMessages([])
      await harness.scheduledFlushes[0]?.operation()

      // then
      expect(harness.calls.map((call) => call.source)).toEqual(["monitor-output:mon_route:batch-5"])
      expect(harness.scheduledFlushes).toHaveLength(2)
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })

  describe("#given idle-mode output arrives with no explicit flush trigger", () => {
    test("#when queueBatch runs for an idle-mode record #then it schedules a flush that delivers exactly once without any session.idle", async () => {
      // given
      const record = createRecord({ mode: "idle" })
      const batch = createBatch(6)
      const harness = createHarness({ active: false })

      // when: only queueBatch runs - no explicit flushMonitor, no session.idle event
      harness.injector.queueBatch(record, batch)

      // then: the queue itself scheduled a flush, and running it delivers exactly once
      expect(harness.scheduledFlushes).toHaveLength(1)
      await harness.scheduledFlushes[0]?.operation()
      expect(harness.calls.map((call) => call.source)).toEqual(["monitor-output:mon_route:batch-6"])
      expect(harness.injector.getPendingBatches(record.id)).toEqual([])
    })
  })
})
