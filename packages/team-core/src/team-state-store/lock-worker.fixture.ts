import { readFile } from "node:fs/promises"
import { parentPort, workerData } from "node:worker_threads"
import { z } from "zod"

import { publishLockRecord } from "./lock-publish"
import { removeLockRecordIfUnchanged } from "./lock-reclaim"
import { buildLockRecord, markLockRecordReleased } from "./lock-record"
import { detectStaleLock, reapStaleLock, withLock } from "./locks"

const { lockPath, counters } = z.object({
  lockPath: z.string(),
  counters: z.instanceof(SharedArrayBuffer),
}).parse(workerData)
const state = new Int32Array(counters)
const port = parentPort
if (port === null) throw new Error("worker fixture requires a parent")
let release: (() => void) | undefined

async function hold(): Promise<void> {
  await withLock(lockPath, async () => {
    if (Atomics.add(state, 0, 1) !== 0) Atomics.add(state, 1, 1)
    const held = new Promise<void>((resolve) => { release = resolve })
    port?.postMessage({ event: "held", record: await readFile(lockPath, "utf8") })
    await held
    Atomics.sub(state, 0, 1)
  }, { staleAfterMs: Infinity })
  port?.postMessage({ event: "released" })
}

async function contend(): Promise<void> {
  const stale = await detectStaleLock(lockPath, Infinity)
  const reaped = await reapStaleLock(lockPath, Infinity)
  const record = await buildLockRecord("contender-probe")
  const published = await publishLockRecord(lockPath, record)
  if (published) {
    markLockRecordReleased(record)
    await removeLockRecordIfUnchanged(lockPath, record, Infinity)
  }
  port?.postMessage({ event: "attempted", stale, reaped, published })
  await withLock(lockPath, async () => {
    if (Atomics.add(state, 0, 1) !== 0) Atomics.add(state, 1, 1)
    Atomics.add(state, 2, 1)
    const held = new Promise<void>((resolve) => { release = resolve })
    port?.postMessage({ event: "entered" })
    await held
    Atomics.sub(state, 0, 1)
  }, { staleAfterMs: Infinity })
  port?.postMessage({ event: "released" })
}

port.on("message", (message: unknown) => {
  if (message === "hold") void hold()
  if (message === "contend") void contend()
  if (message === "release") release?.()
  if (message === "strand") {
    void (async () => {
      const strandedRecord = await buildLockRecord("failed-unlink")
      if (!await publishLockRecord(lockPath, strandedRecord)) throw new Error("fixture lock already held")
      markLockRecordReleased(strandedRecord)
      port.postMessage({ event: "stranded" })
    })()
  }
})
port.postMessage({ event: "ready" })
