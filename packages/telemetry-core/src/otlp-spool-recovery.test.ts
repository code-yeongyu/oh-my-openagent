import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { linkSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import * as timersPromises from "node:timers/promises"

import { createBatchId, parseSpoolName, type SpoolContext } from "./otlp-spool-dir"
import { frame } from "./otlp-spool-file"
import {
  attributeMap,
  capture,
  createSpoolRoot,
  decodeLogs,
  logRecordsOf,
  makeTransport,
  recordingFetch,
  spoolNames,
  testResource,
} from "./otlp-test-support"

const DAY_MS = 24 * 60 * 60 * 1000
// A short shutdown cap keeps the shutdown tests fast. The flush deadline is derived from #shutdown in
// otlp-sender-core.ts: cap - min(SHUTDOWN_CLEANUP_RESERVE_MS, cap / 10) = 400 - min(200, 40) = 360.
const CAP_MS = 400
const FLUSH_DEADLINE_MS = 360
// The outer breaker: far above any cap, so only a shutdown that never returns reaches it.
const BREAKER_MS = 10_000
// A generous bound for the never-settling test: ten caps (4 s against the real ~0.4 s). Waits through the
// global setTimeout, Bun.sleep and node:timers/promises are caught by identity. Everything else (a
// synchronous stall, setInterval or setImmediate polling, AbortSignal.timeout) is seen only by this clock.
// It is 10x the cap, not the 1.3x budget a loaded Windows runner exceeded (#10967).
const TEN_CAPS_MS = 10 * CAP_MS

/** One timer armed while a recorder is installed: its arm order, delay, and whether it has fired. */
type RecordedTimer = { readonly seq: number; readonly ms: number; fired: boolean }

/**
 * Records every timer armed while installed (shutdown's deadlines are plain timers), and every Bun.sleep and
 * node:timers/promises setTimeout call: neither goes through the global setTimeout, so both are spied by
 * identity. The restore is also queued on the file's cleanup list, so a test that throws before its own
 * finally never leaks the patches.
 */
function recordTimers(): {
  readonly armed: RecordedTimer[]
  readonly otherWaits: () => number
  readonly restore: () => void
} {
  const original = globalThis.setTimeout
  const armed: RecordedTimer[] = []
  const recording = (handler: Parameters<typeof setTimeout>[0], ms?: number, ...args: unknown[]) => {
    const timer: RecordedTimer = { seq: armed.length, ms: Number(ms ?? 0), fired: false }
    armed.push(timer)
    if (typeof handler !== "function") return original(handler, ms, ...args)
    return original((...handlerArgs: unknown[]) => {
      timer.fired = true
      return handler(...handlerArgs)
    }, ms, ...args)
  }
  globalThis.setTimeout = recording as unknown as typeof setTimeout
  const sleep = spyOn(Bun, "sleep")
  const promisedTimeout = spyOn(timersPromises, "setTimeout")
  const restore = (): void => {
    globalThis.setTimeout = original
    sleep.mockRestore()
    promisedTimeout.mockRestore()
  }
  roots.push(restore)
  return { armed, otherWaits: () => sleep.mock.calls.length + promisedTimeout.mock.calls.length, restore }
}

/**
 * "settled" when the work settles within `boundMs`, else a named breaker message (never a pass by timing).
 * The clock starts before `start` runs, so a synchronous stall anywhere in the work counts, and it is read
 * again on settle, because a synchronous stall also holds the breaker's own timer back.
 */
async function settleOrBreak(start: () => Promise<unknown>, what: string, boundMs = BREAKER_MS): Promise<string> {
  const breakMessage = `breaker: no ${what} within ${boundMs} ms`
  let breaker: ReturnType<typeof setTimeout> | undefined
  const broke = new Promise<string>((resolve) => {
    breaker = setTimeout(() => resolve(breakMessage), boundMs)
  })
  const startedMs = performance.now()
  try {
    const settled = start().then(() => (performance.now() - startedMs <= boundMs ? "settled" : breakMessage))
    return await Promise.race([settled, broke])
  } finally {
    clearTimeout(breaker)
  }
}

const roots: (() => void)[] = []
afterEach(() => {
  // Undo in reverse: a test that installs two timer recorders gets the real setTimeout back, not the first patch.
  for (const cleanup of roots.splice(0).reverse()) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-recovery-")
  roots.push(created.cleanup)
  return created.dir
}

function context(dir: string, overrides: Partial<SpoolContext> = {}): SpoolContext {
  return {
    dir,
    bootId: "c".repeat(32),
    pid: 1,
    nowMs: Date.now,
    isPidAlive: () => true,
    capBytes: 5 * 1024 * 1024,
    maxAgeMs: 14 * DAY_MS,
    onDrop: () => undefined,
    ...overrides,
  }
}

describe("spool recovery", () => {
  test("#given a header-less batch file #then it is quarantined and counted corrupt, never sent", async () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const name = `batch-logs-${createBatchId(Date.now())}.otlp`
    writeFileSync(join(dir, name), Buffer.concat([frame(new Uint8Array([9, 9, 9])), frame(new Uint8Array([1, 2]))]))
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    await transport.flush()

    // then
    expect(calls.length).toBe(0)
    expect(spoolNames(dir)).toEqual(["quarantine"])
    expect(spoolNames(join(dir, "quarantine")).length).toBe(1)
    expect(transport.droppedEvents()).toBe(2)
  })

  test("#given a file written by service.version 1.0.0 #when a 1.1.0 build replays it #then the request's Resource says 1.0.0", async () => {
    // given
    const dir = root()
    const old = makeTransport(dir, { resource: testResource("1.0.0"), fetch: recordingFetch(() => new Response(null, { status: 503 })).fetch })
    capture(old, "feature_used", { feature: "a" })
    await old.flush()
    const { calls, fetch } = recordingFetch()
    const current = makeTransport(dir, { resource: testResource("1.1.0"), fetch })

    // when
    await current.flush()

    // then
    const resource = decodeLogs(calls[0]?.body ?? new Uint8Array()).resourceLogs[0]?.resource
    expect(attributeMap(resource?.attributes ?? [])["service.version"]).toBe("1.0.0")
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given an expired claim, a live claim and a live producer's active file #when a sweep runs #then only the expired claim is reclaimed", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const expired = `batch-logs-${createBatchId(now)}.sending-${"a".repeat(32)}-${now - 1}`
    const live = `batch-logs-${createBatchId(now)}.sending-${"a".repeat(32)}-${now + 60_000}`
    const producer = `active-logs-999-${"b".repeat(32)}.otlp`
    for (const name of [expired, live, producer]) writeFileSync(join(dir, name), "")
    utimesSync(join(dir, producer), new Date(now - 10 * 60_000), new Date(now - 10 * 60_000))
    const transport = makeTransport(dir, { isPidAlive: (pid) => pid === 999 })

    // when
    transport.sweep()

    // then
    expect(spoolNames(dir)).toEqual([live, producer, `${expired.split(".sending-")[0] ?? ""}.otlp`].sort())
  })

  test("#given a dead owner's active file #then it is sealed only after 5 minutes idle", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const name = `active-traces-999-${"b".repeat(32)}.otlp`
    writeFileSync(join(dir, name), "")
    let now = Date.now()
    utimesSync(join(dir, name), new Date(now - 1_000), new Date(now - 1_000))
    now -= 1_000
    const transport = makeTransport(dir, { isPidAlive: () => false, nowMs: () => now })

    // when
    transport.sweep()
    const fresh = spoolNames(dir)
    now += 300_000
    transport.sweep()

    // then
    expect(fresh).toEqual([name])
    expect(spoolNames(dir)[0]).toMatch(/^batch-traces-[0-9a-f-]{36}\.otlp$/)
  })

  test("#given a crash between linking the new name and unlinking the old one (seal or claim release) #then the sweep drops the old name and the batch stays exactly once", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const now = Date.now()
    const sealedId = createBatchId(now)
    const releasedId = createBatchId(now)
    const active = `active-logs-999-${"b".repeat(32)}.otlp`
    const expiredClaim = `batch-logs-${releasedId}.sending-${"a".repeat(32)}-${now - 1}`
    writeFileSync(join(dir, active), "")
    writeFileSync(join(dir, expiredClaim), "")
    linkSync(join(dir, active), join(dir, `batch-logs-${sealedId}.otlp`))
    linkSync(join(dir, expiredClaim), join(dir, `batch-logs-${releasedId}.otlp`))
    const transport = makeTransport(dir, { isPidAlive: () => false, nowMs: () => now + 300_000 })

    // when
    transport.sweep()

    // then
    expect(spoolNames(dir)).toEqual([`batch-logs-${sealedId}.otlp`, `batch-logs-${releasedId}.otlp`].sort())
  })

  test("#given a sealed batch older than 14 days by its own batch id #then it is deleted unsent and counted expired", async () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `batch-logs-${createBatchId(Date.now() - 15 * DAY_MS)}.otlp`), Buffer.concat([frame(new Uint8Array([1, 1])), frame(new Uint8Array([8, 1]))]))
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    transport.sweep()
    await transport.flush()

    // then
    const dropped = calls.flatMap((c) => logRecordsOf(decodeLogs(c.body))).map((r) => attributeMap(r.attributes))
    expect(dropped).toEqual([expect.objectContaining({ "omo.dropped.reason": "expired", "omo.dropped.count": 1 })])
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given a 2,000-event burst over 5 MB #then the oldest files are evicted, one client_dropped reports the count, and the counter is 0 after the next 200", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })
    const wide = Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`k${index}`, `${index}`.padEnd(64, "x")]))

    // when
    for (let index = 0; index < 2_000; index += 1) capture(transport, "feature_used", { ...wide, seq: index })
    const droppedBeforeSend = transport.droppedEvents()
    await transport.flush()

    // then
    const records = calls.flatMap((c) => logRecordsOf(decodeLogs(c.body)))
    const reports = records.filter((r) => r.eventName === "omo.client_dropped").map((r) => attributeMap(r.attributes))
    expect(droppedBeforeSend).toBeGreaterThan(0)
    expect(reports).toEqual([expect.objectContaining({ "omo.dropped.reason": "evicted", "omo.dropped.count": droppedBeforeSend })])
    expect(records.length - 1 + droppedBeforeSend).toBe(2_000)
    expect(transport.droppedEvents()).toBe(0)
  }, 60_000)

  test("#given a fetch that never settles #when the transport shuts down #then only its own deadlines end it, nothing else is waited on, and the batch stays on disk", async () => {
    // given
    const dir = root()
    const timers = recordTimers()
    const transport = makeTransport(dir, { shutdownTimeoutMs: CAP_MS, fetch: () => new Promise<Response>(() => undefined) })
    capture(transport, "feature_used", { feature: "a" })

    try {
      // when
      let firstShutdownSeq = 0
      let firedWhenShutdownReturned: RecordedTimer[] = []
      let otherWaitsWhenShutdownReturned = 0
      const outcome = await settleOrBreak(
        () => {
          firstShutdownSeq = timers.armed.length
          const waitsBefore = timers.otherWaits()
          return transport.shutdown().then(() => {
            firedWhenShutdownReturned = timers.armed.filter((timer) => timer.seq >= firstShutdownSeq && timer.fired)
            otherWaitsWhenShutdownReturned = timers.otherWaits() - waitsBefore
          })
        },
        "shutdown returning once its deadlines fire",
        TEN_CAPS_MS,
      )

      // then
      // No wait of any kind (a timer, Bun.sleep, a synchronous stall anywhere) held shutdown for ten caps...
      expect(outcome).toBe("settled")
      // ...shutdown arms its two deadlines back to back before anything else, so they are, by position, the
      // first two timers armed after the call: the flush deadline, then the cap. Matching by length instead
      // would let an extra wait of the same length pass as one of them...
      const ownFlushDeadline = timers.armed[firstShutdownSeq]
      const ownCap = timers.armed[firstShutdownSeq + 1]
      expect([ownFlushDeadline?.ms, ownCap?.ms]).toEqual([FLUSH_DEADLINE_MS, CAP_MS])
      // ...the flush deadline fired, and the only other timer that may have fired is shutdown's own cap
      // (it does when a claim is still in flight). Any other fired timer, of any length, is an extra wait.
      expect(firedWhenShutdownReturned).toContain(ownFlushDeadline as RecordedTimer)
      expect(firedWhenShutdownReturned.filter((timer) => timer !== ownFlushDeadline && timer !== ownCap)).toEqual([])
      // ...and nothing waited through Bun.sleep or node:timers/promises either.
      expect(otherWaitsWhenShutdownReturned).toBe(0)
      const entries = spoolNames(dir).map(parseSpoolName)
      expect(entries.filter((entry) => entry.kind !== "lock"), `spool entries: ${JSON.stringify(entries)}`).toEqual([
        expect.objectContaining({ kind: expect.stringMatching(/^(batch|sending)$/), signal: "logs" }),
      ])
    } finally {
      timers.restore()
    }
  }, 30_000)

  test("#given shutdown's flush starts with synchronous work #then both shutdown deadlines were armed before that work ran, so it counts against the cap measured from the call", async () => {
    // given
    const dir = root()
    const timers = recordTimers()
    let armedWhenFlushWorkRan: number[] | undefined
    let markNextConsentCheck = false
    const consent = (): boolean => {
      if (markNextConsentCheck) {
        markNextConsentCheck = false
        armedWhenFlushWorkRan = timers.armed.map((timer) => timer.ms)
      }
      return true
    }
    const transport = makeTransport(dir, { consent, shutdownTimeoutMs: CAP_MS, fetch: () => new Promise<Response>(() => undefined) })
    capture(transport, "feature_used", { feature: "a" })
    markNextConsentCheck = true

    try {
      // when
      const outcome = await settleOrBreak(() => transport.shutdown(), "shutdown returning once its cap fires")

      // then
      expect(outcome).toBe("settled")
      expect(armedWhenFlushWorkRan).toEqual(expect.arrayContaining([FLUSH_DEADLINE_MS, CAP_MS]))
      const entries = spoolNames(dir).map(parseSpoolName)
      expect(entries.filter((entry) => entry.kind !== "lock"), `spool entries: ${JSON.stringify(entries)}`).toEqual([
        expect.objectContaining({ kind: expect.stringMatching(/^(batch|sending)$/), signal: "logs" }),
      ])
    } finally {
      timers.restore()
    }
  }, 30_000)
})
