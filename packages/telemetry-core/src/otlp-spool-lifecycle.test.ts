import { afterEach, describe, expect, test } from "bun:test"
import { statSync } from "node:fs"
import { join } from "node:path"

import { create, toBinary } from "@bufbuild/protobuf"

import { ExportLogsServiceResponseSchema } from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"

import { claimBatch, createBatchId, CLAIM_LEASE_MS, type SpoolContext } from "./otlp-spool-dir"
import {
  attributeMap,
  capture,
  createSpoolRoot,
  decodeLogs,
  logRecordsOf,
  makeTransport,
  recordingFetch,
  spoolNames,
} from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-lifecycle-")
  roots.push(created.cleanup)
  return created.dir
}

function uids(calls: readonly { readonly body: Uint8Array }[]): string[] {
  return calls.flatMap((c) => logRecordsOf(decodeLogs(c.body))).map((r) => String(attributeMap(r.attributes)["log.record.uid"]))
}

function ids(count: number): string[] {
  return Array.from({ length: count }, () => Bun.randomUUIDv7())
}

type Tick = { readonly ms: number; readonly run: () => Promise<void> }

function manualScheduler() {
  const ticks: Tick[] = []
  const scheduleEvery = (run: () => Promise<void>, ms: number) => {
    ticks.push({ ms, run })
    return { cancel: () => undefined }
  }
  const sweepTick = (): Promise<void> => {
    const tick = ticks.find((t) => t.ms === 60_000)
    if (tick === undefined) throw new Error("no 60 s sweep tick was scheduled")
    return tick.run()
  }
  return { scheduleEvery, sweepTick, ticks }
}

function sealedBatch(dir: string, records: number, createdMs: number): string {
  const writer = makeTransport(dir, { pid: 4_000, bootId: "0".repeat(32), flushAt: 1_000 })
  for (let seq = 0; seq < records; seq += 1) capture(writer, "feature_used", { seq, feature: "x".repeat(64) })
  const name = writer.providers.logWriter.seal(createBatchId(createdMs))
  if (name === null) throw new Error("nothing to seal")
  return name
}

const sizeOf = (dir: string, name: string): number => statSync(join(dir, name)).size

describe("spool file modes", () => {
  test("#given a consented capture, seal and claim #then the directory is 0700 and every spool file is 0600", async () => {
    // given
    const dir = root()
    let claimedMode = -1
    const transport = makeTransport(dir, {
      fetch: async () => {
        claimedMode = statSync(join(dir, spoolNames(dir).find((n) => n.includes(".sending-")) ?? "")).mode & 0o777
        return new Response(null, { status: 503 })
      },
    })
    capture(transport, "feature_used", { feature: "a" })
    const activeMode = statSync(join(dir, spoolNames(dir)[0] ?? "")).mode & 0o777

    // when
    await transport.flush()

    // then
    if (process.platform === "win32") return
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(activeMode).toBe(0o600)
    expect(claimedMode).toBe(0o600)
    expect(statSync(join(dir, spoolNames(dir)[0] ?? "")).mode & 0o777).toBe(0o600)
  })
})

describe("spool cap on every sweep", () => {
  test("#given sealed batches from earlier processes over the cap #when a sweep runs #then the oldest are evicted first and counted, the newest kept", async () => {
    // given
    const dir = root()
    const now = Date.now()
    const oldest = sealedBatch(dir, 3, now - 3_000)
    const middle = sealedBatch(dir, 2, now - 2_000)
    const newest = sealedBatch(dir, 1, now - 1_000)
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch, capBytes: sizeOf(dir, newest) })

    // when
    transport.sweep()
    const afterSweep = spoolNames(dir)
    const dropped = transport.droppedEvents()

    // then
    expect(afterSweep).toEqual([newest])
    expect(afterSweep).not.toContain(oldest)
    expect(afterSweep).not.toContain(middle)
    expect(dropped).toBe(5)
    expect(calls.length).toBe(0)
  })
})

describe("producer versus replayer", () => {
  test("#given A producing and B replaying in one spool #then B never claims A's live active file, A's sealed batches are sent once, and a batch A sealed before dying is sent by B", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    let aAlive = true
    const a = makeTransport(dir, { fetch, pid: 4_101, bootId: "a".repeat(32), flushAt: 1_000 })
    const isPidAlive = (pid: number): boolean => (pid === 4_101 ? aAlive : true)
    const [e1, e2, e3] = ids(3)
    capture(a, "feature_used", { event_id: e1 })

    // when
    const b = makeTransport(dir, { fetch, pid: 4_102, bootId: "b".repeat(32), isPidAlive, nowMs: () => Date.now() + 600_000 })
    b.sweep()
    await b.flush()
    const sentWhileAWritesE1 = calls.length
    const aActiveStillThere = spoolNames(dir).some((n) => n.startsWith("active-logs-4101-"))
    await a.flush()
    capture(a, "feature_used", { event_id: e2 })
    capture(a, "feature_used", { event_id: e3 })
    a.providers.logWriter.seal(createBatchId(Date.now()))
    aAlive = false
    b.sweep()
    await b.flush()

    // then
    expect(sentWhileAWritesE1).toBe(0)
    expect(aActiveStillThere).toBe(true)
    expect(uids(calls).sort()).toEqual([e1, e2, e3].sort())
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given two live transports starting together over the same dead-owner active file and sealed batch #then each record is sent exactly once", async () => {
    // given
    const dir = root()
    const dead = makeTransport(dir, { pid: 4_201, bootId: "d".repeat(32), flushAt: 1_000 })
    const [sealedId, activeId] = ids(2)
    capture(dead, "feature_used", { event_id: sealedId })
    dead.providers.logWriter.seal(createBatchId(Date.now()))
    capture(dead, "feature_used", { event_id: activeId })
    const { calls, fetch } = recordingFetch()
    const later = (): number => Date.now() + 600_000
    const isPidAlive = (pid: number): boolean => pid !== 4_201

    // when
    const one = makeTransport(dir, { fetch, pid: 4_202, bootId: "1".repeat(32), isPidAlive, nowMs: later, autoStart: true })
    const two = makeTransport(dir, { fetch, pid: 4_203, bootId: "2".repeat(32), isPidAlive, nowMs: later, autoStart: true })
    await Promise.all([one.ready, two.ready])
    await Promise.all([one.shutdown(), two.shutdown()])

    // then
    expect(uids(calls).sort()).toEqual([sealedId, activeId].sort())
    expect(spoolNames(dir)).toEqual([])
  })
})

describe("restart before the lease grace", () => {
  test("#given B died holding a fresh claim at t0 and C starts at +60 s #then C sends nothing before +300 s and reclaims and sends it on the first periodic sweep at or after +300 s", async () => {
    // given
    const dir = root()
    const t0 = Date.now()
    const producer = makeTransport(dir, { pid: 4_301, bootId: "e".repeat(32), flushAt: 1_000 })
    const events = ids(3)
    for (const id of events) capture(producer, "feature_used", { event_id: id })
    const batchId = createBatchId(t0)
    producer.providers.logWriter.seal(batchId)
    const bCtx: SpoolContext = {
      dir,
      bootId: "f".repeat(32),
      pid: 4_302,
      nowMs: () => t0,
      isPidAlive: () => false,
      capBytes: 5 * 1024 * 1024,
      maxAgeMs: 14 * 86_400_000,
      onDrop: () => undefined,
    }
    const claim = await claimBatch(bCtx, { signal: "logs", batchId })
    let now = t0 + 60_000
    const { calls, fetch } = recordingFetch()
    const scheduler = manualScheduler()
    const c = makeTransport(dir, {
      fetch,
      pid: 4_303,
      bootId: "9".repeat(32),
      isPidAlive: () => false,
      nowMs: () => now,
      autoStart: true,
      scheduleEvery: scheduler.scheduleEvery,
    })
    await c.ready

    // when
    const sendsBefore: number[] = []
    for (const at of [120_000, 180_000, 240_000]) {
      now = t0 + at
      await scheduler.sweepTick()
      sendsBefore.push(calls.length)
    }
    now = t0 + 300_000
    await scheduler.sweepTick()

    // then
    expect(claim).toBe(`batch-logs-${batchId}.sending-${"f".repeat(32)}-${t0 + CLAIM_LEASE_MS}`)
    expect(sendsBefore).toEqual([0, 0, 0])
    expect(calls.length).toBe(1)
    expect(uids(calls).sort()).toEqual([...events].sort())
    expect(spoolNames(dir)).toEqual([])
  })
})

describe("replay-time consent and acknowledgment", () => {
  test("#given consent withdrawn after start #when the periodic sweep runs #then every spool file is deleted unsent", async () => {
    // given
    const dir = root()
    sealedBatch(dir, 2, Date.now() - 1_000)
    let consented = true
    const { calls, fetch } = recordingFetch()
    const scheduler = manualScheduler()
    const transport = makeTransport(dir, { fetch, consent: () => consented, autoStart: true, scheduleEvery: scheduler.scheduleEvery })
    await transport.ready
    sealedBatch(dir, 2, Date.now())

    // when
    consented = false
    await scheduler.sweepTick()

    // then
    expect(calls.length).toBe(1)
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given consent withdrawn while a batch is claimed but before its POST #then the batch is deleted and never sent", async () => {
    // given
    const dir = root()
    const consent = (): boolean => !spoolNames(dir).some((name) => name.includes(".sending-"))
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch, consent })
    capture(transport, "feature_used", { feature: "a" })

    // when
    await transport.flush()

    // then
    expect(calls.length).toBe(0)
    expect(spoolNames(dir)).toEqual([])
  })

  test("#given a replayed batch answered 503 on every attempt #then the file is kept as a sealed batch", async () => {
    // given
    const dir = root()
    const name = sealedBatch(dir, 2, Date.now() - 1_000)
    const { calls, fetch } = recordingFetch(() => new Response(null, { status: 503 }))
    const transport = makeTransport(dir, { fetch })

    // when
    await transport.flush()

    // then
    expect(calls.length).toBe(6)
    expect(spoolNames(dir)).toEqual([name])
    expect(transport.droppedEvents()).toBe(0)
  })

  test("#given the collector's drain reply (200, partial_success rejected 0 with message 'mode: drain') #then the file is deleted as delivered and nothing is counted dropped", async () => {
    // given
    const dir = root()
    sealedBatch(dir, 2, Date.now() - 1_000)
    const drained = toBinary(
      ExportLogsServiceResponseSchema,
      create(ExportLogsServiceResponseSchema, { partialSuccess: { rejectedLogRecords: 0n, errorMessage: "mode: drain" } }),
    )
    const { calls, fetch } = recordingFetch(() => new Response(drained, { status: 200 }))
    const transport = makeTransport(dir, { fetch })

    // when
    await transport.flush()

    // then
    expect(calls.length).toBe(1)
    expect(spoolNames(dir)).toEqual([])
    expect(transport.droppedEvents()).toBe(0)
  })
})
