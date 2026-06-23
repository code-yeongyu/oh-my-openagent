import { describe, expect, it, mock } from "bun:test"
import { OutboxWorker } from "./outbox-worker"
import type { OutboxEntry } from "./types"

const makeEntry = (id: string, retry_count = 0): OutboxEntry => ({
  outbox_id: id,
  memory_id: `m_${id}`,
  provider_name: "mem0",
  operation: "create",
  idempotency_key: `idem_${id}`,
  status: "pending",
  created_at: new Date().toISOString(),
  retry_count,
})

const makeDeps = (overrides: Partial<ReturnType<typeof makeBaseDeps>> = {}) => ({
  ...makeBaseDeps(),
  ...overrides,
})

const makeBaseDeps = () => ({
  fetchPending: mock(async (_limit: number): Promise<OutboxEntry[]> => [makeEntry("o_1")]),
  claimEntry: mock(async (_id: string) => true),
  markSynced: mock(async (_id: string) => {}),
  markFailed: mock(async (_id: string, _err: string, _retry: boolean) => {}),
  incrementRetry: mock(async (_id: string) => 1),
  dispatch: { dispatch: mock(async (_entry: OutboxEntry) => {}) },
})

describe("OutboxWorker", () => {
  describe("#given a new worker", () => {
    describe("#when instantiated", () => {
      it("#then starts in stopped state", () => {
        const worker = new OutboxWorker(makeDeps())
        expect(worker.getState().isRunning).toBe(false)
        expect(worker.getState().circuitBreaker).toBe("closed")
        expect(worker.getState().totalProcessed).toBe(0)
      })
    })

    describe("#when start() is called", () => {
      it("#then isRunning becomes true", () => {
        const worker = new OutboxWorker(makeDeps(), { pollIntervalMs: 999_999 })
        worker.start()
        expect(worker.getState().isRunning).toBe(true)
        worker.stop()
      })
    })

    describe("#when stop() is called after start", () => {
      it("#then isRunning becomes false", () => {
        const worker = new OutboxWorker(makeDeps(), { pollIntervalMs: 999_999 })
        worker.start()
        worker.stop()
        expect(worker.getState().isRunning).toBe(false)
      })
    })
  })

  describe("#given a running worker with pending entries", () => {
    describe("#when poll() is called and dispatch succeeds", () => {
      it("#then claims entry, dispatches, and marks synced", async () => {
        const deps = makeDeps()
        const worker = new OutboxWorker(deps, { pollIntervalMs: 999_999 })
        await worker.poll()
        expect(deps.claimEntry).toHaveBeenCalledWith("o_1")
        expect(deps.dispatch.dispatch).toHaveBeenCalledTimes(1)
        expect(deps.markSynced).toHaveBeenCalledWith("o_1")
        expect(worker.getState().totalProcessed).toBe(1)
        expect(worker.getState().totalFailed).toBe(0)
      })
    })

    describe("#when poll() is called and dispatch throws", () => {
      it("#then increments retry and marks failed", async () => {
        const deps = makeDeps()
        deps.dispatch.dispatch = mock(async () => {
          throw new Error("network error")
        })
        const worker = new OutboxWorker(deps, { pollIntervalMs: 999_999 })
        await worker.poll()
        expect(deps.incrementRetry).toHaveBeenCalledWith("o_1")
        expect(deps.markFailed).toHaveBeenCalled()
        expect(worker.getState().totalFailed).toBe(1)
        expect(worker.getState().totalProcessed).toBe(0)
      })
    })

    describe("#when retry count reaches maxRetries", () => {
      it("#then markFailed is called with shouldRetry=false", async () => {
        const deps = makeDeps()
        deps.dispatch.dispatch = mock(async () => {
          throw new Error("permanent failure")
        })
        deps.incrementRetry = mock(async () => 3)
        const worker = new OutboxWorker(deps, {
          pollIntervalMs: 999_999,
          maxRetries: 3,
        })
        await worker.poll()
        expect(deps.markFailed).toHaveBeenCalledWith("o_1", "permanent failure", false)
      })
    })
  })

  describe("#given claimEntry returns false", () => {
    describe("#when processEntry runs", () => {
      it("#then dispatch is not called", async () => {
        const deps = makeDeps()
        deps.claimEntry = mock(async () => false)
        const worker = new OutboxWorker(deps, { pollIntervalMs: 999_999 })
        await worker.poll()
        expect(deps.dispatch.dispatch).not.toHaveBeenCalled()
        expect(deps.markSynced).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given claimEntry throws", () => {
    describe("#when processEntry runs", () => {
      it("#then processing is skipped safely", async () => {
        const deps = makeDeps()
        deps.claimEntry = mock(async () => {
          throw new Error("db error")
        })
        const worker = new OutboxWorker(deps, { pollIntervalMs: 999_999 })
        await worker.poll()
        expect(deps.dispatch.dispatch).not.toHaveBeenCalled()
      })
    })
  })

  describe("#given consecutive dispatch failures", () => {
    describe("#when failure count reaches circuitBreakerThreshold", () => {
      it("#then circuit breaker opens", async () => {
        const deps = makeDeps()
        deps.dispatch.dispatch = mock(async () => {
          throw new Error("fail")
        })
        const worker = new OutboxWorker(deps, {
          pollIntervalMs: 999_999,
          circuitBreakerThreshold: 2,
          maxRetries: 10,
        })
        await worker.poll()
        await worker.poll()
        expect(worker.getState().circuitBreaker).toBe("open")
      })
    })
  })

  describe("#given an open circuit breaker within reset window", () => {
    describe("#when poll() is called", () => {
      it("#then fetchPending is not called", async () => {
        const deps = makeDeps()
        deps.dispatch.dispatch = mock(async () => {
          throw new Error("fail")
        })
        const worker = new OutboxWorker(deps, {
          pollIntervalMs: 999_999,
          circuitBreakerThreshold: 1,
          circuitBreakerResetMs: 999_999,
          maxRetries: 10,
        })
        await worker.poll()
        expect(worker.getState().circuitBreaker).toBe("open")
        const countBefore = deps.fetchPending.mock.calls.length
        await worker.poll()
        expect(deps.fetchPending.mock.calls.length).toBe(countBefore)
      })
    })
  })

  describe("#given fetchPending throws", () => {
    describe("#when poll() is called", () => {
      it("#then recordFailure is triggered without dispatching", async () => {
        const deps = makeDeps()
        deps.fetchPending = mock(async () => {
          throw new Error("db down")
        })
        const worker = new OutboxWorker(deps, {
          pollIntervalMs: 999_999,
          circuitBreakerThreshold: 100,
        })
        await worker.poll()
        expect(deps.dispatch.dispatch).not.toHaveBeenCalled()
        expect(worker.getState().consecutiveFailures).toBe(1)
      })
    })
  })

  describe("#given an empty pending queue", () => {
    describe("#when poll() is called", () => {
      it("#then consecutiveFailures is reset to zero", async () => {
        const deps = makeDeps()
        deps.fetchPending = mock(async () => [])
        const worker = new OutboxWorker(deps, { pollIntervalMs: 999_999 })
        await worker.poll()
        expect(worker.getState().consecutiveFailures).toBe(0)
      })
    })
  })
})
