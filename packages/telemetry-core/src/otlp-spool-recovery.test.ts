import { afterEach, describe, expect, test } from "bun:test"
import { linkSync, mkdirSync, utimesSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { claimBatch, createBatchId, type SpoolContext } from "./otlp-spool-dir"
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
const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
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

  test("#given two sweepers racing for one sealed batch #then exactly one claim wins", async () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const batchId = createBatchId(Date.now())
    writeFileSync(join(dir, `batch-logs-${batchId}.otlp`), "")

    // when
    const claims = await Promise.all([
      claimBatch(context(dir, { bootId: "1".repeat(32) }), { signal: "logs", batchId }),
      claimBatch(context(dir, { bootId: "2".repeat(32) }), { signal: "logs", batchId }),
    ])

    // then
    expect(claims.filter((claim) => claim !== null).length).toBe(1)
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

  test("#given a fetch that never settles #when the transport shuts down #then it returns within 2,600 ms (the 2 s cap plus scheduling slack) and the batch stays on disk", async () => {
    // given
    const dir = root()
    const transport = makeTransport(dir, { fetch: () => new Promise<Response>(() => undefined) })
    capture(transport, "feature_used", { feature: "a" })

    // when
    const started = performance.now()
    await transport.shutdown()
    const elapsed = performance.now() - started

    // then
    expect(elapsed).toBeLessThan(2_600)
    expect(spoolNames(dir).length).toBe(1)
    expect(spoolNames(dir)[0]).toMatch(/^batch-logs-[0-9a-f-]{36}\.otlp$/)
  }, 30_000)

  test("#given shutdown's flush starts with 1.5 s of synchronous work #then shutdown still returns within the 2 s cap measured from the call (plus scheduling slack, far below the 3.5 s a late cap would take)", async () => {
    // given
    const dir = root()
    let stallNextConsentCheck = false
    const consent = (): boolean => {
      if (stallNextConsentCheck) {
        stallNextConsentCheck = false
        Bun.sleepSync(1_500)
      }
      return true
    }
    const transport = makeTransport(dir, { consent, fetch: () => new Promise<Response>(() => undefined) })
    capture(transport, "feature_used", { feature: "a" })
    stallNextConsentCheck = true

    // when
    const started = performance.now()
    await transport.shutdown()
    const elapsed = performance.now() - started

    // then
    expect(elapsed).toBeLessThan(2_600)
    expect(spoolNames(dir)[0]).toMatch(/^batch-logs-[0-9a-f-]{36}\.otlp$/)
  }, 30_000)
})
