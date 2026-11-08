import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, writeSync } from "node:fs"
import { dirname, join } from "node:path"

import { readFrames } from "./otlp-spool-file"
import { SpoolWriter } from "./otlp-wal"
import { attributeMap, capture, createSpoolRoot, decodeLogs, logRecordsOf, makeTransport, recordingFetch } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-spool-write-")
  roots.push(created.cleanup)
  return created.dir
}

function enospc(): Error {
  return Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" })
}

type LostRecords = { readonly error: unknown; readonly records: number }

function writer(
  dir: string,
  write: (fd: number, bytes: Uint8Array) => number,
  errors: unknown[] = [],
  extra: { readonly truncate?: (fd: number, length: number) => void; readonly lost?: LostRecords[] } = {},
): SpoolWriter {
  return new SpoolWriter({
    dir,
    signal: "logs",
    pid: 1,
    bootId: "e".repeat(32),
    header: new Uint8Array([1, 1]),
    consent: () => true,
    onError: (error, records) => {
      errors.push(error)
      extra.lost?.push({ error, records })
    },
    write,
    ...(extra.truncate === undefined ? {} : { truncate: extra.truncate }),
  })
}

describe("short and failed spool writes", () => {
  test("#given the OS writes only part of each frame #then the writer finishes every frame and the file reads back whole", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    let calls = 0
    const spool = writer(dir, (fd, bytes) => {
      calls += 1
      return writeSync(fd, bytes.subarray(0, Math.ceil(bytes.byteLength / 2)))
    })

    // when
    const appended = [new Uint8Array([1, 2, 3, 4, 5]), new Uint8Array([6, 7, 8]), new Uint8Array([9])].map((p) => spool.append(p))

    // then
    expect(appended).toEqual([true, true, true])
    expect(calls).toBeGreaterThan(4)
    const frames = readFrames(new Uint8Array(readFileSync(join(dir, spool.name))))
    expect(frames.map((f) => Array.from(f))).toEqual([[1, 1], [1, 2, 3, 4, 5], [6, 7, 8], [9]])
  })

  test("#given a write that fails after part of a frame landed #then the frame is rolled back and later frames stay readable", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const errors: unknown[] = []
    let failNext = false
    const spool = writer(dir, (fd, bytes) => {
      if (failNext) {
        failNext = false
        throw enospc()
      }
      if (bytes.byteLength > 6) {
        failNext = true
        return writeSync(fd, bytes.subarray(0, 3))
      }
      return writeSync(fd, bytes)
    }, errors)

    // when
    const first = spool.append(new Uint8Array([1]))
    const torn = spool.append(new Uint8Array([2, 2, 2, 2, 2, 2, 2, 2]))
    const after = spool.append(new Uint8Array([3]))

    // then
    expect([first, torn, after]).toEqual([true, false, true])
    expect(errors.length).toBe(1)
    const frames = readFrames(new Uint8Array(readFileSync(join(dir, spool.name))))
    expect(frames.map((f) => Array.from(f))).toEqual([[1, 1], [1], [3]])
    expect(spool.records).toBe(2)
  })

  test("#given a torn frame whose truncate also fails #when the active file is abandoned #then every record that was in it is reported as lost, not only the failing one", () => {
    // given
    const dir = root()
    mkdirSync(dir, { recursive: true })
    const lost: LostRecords[] = []
    let tear = false
    const spool = writer(
      dir,
      (fd, bytes) => {
        if (!tear) return writeSync(fd, bytes)
        tear = false
        writeSync(fd, bytes.subarray(0, 2))
        throw enospc()
      },
      [],
      { truncate: () => { throw enospc() }, lost },
    )
    spool.append(new Uint8Array([1]))
    spool.append(new Uint8Array([2]))
    tear = true

    // when
    const torn = spool.append(new Uint8Array([3, 3, 3, 3]))

    // then
    expect(torn).toBe(false)
    expect(existsSync(join(dir, spool.name))).toBe(false)
    expect(lost.reduce((sum, entry) => sum + entry.records, 0)).toBe(3)
    expect(spool.append(new Uint8Array([4]))).toBe(true)
    expect(readFrames(new Uint8Array(readFileSync(join(dir, spool.name)))).map((f) => Array.from(f))).toEqual([[1, 1], [4]])
  })

  test("#given an event lost to a spool write failure #then droppedEvents counts it and the next flush reports it as write_failed", async () => {
    // given
    const dir = root()
    mkdirSync(dirname(dir), { recursive: true })
    writeFileSync(dir, "a file where the spool directory should be")
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })
    capture(transport, "feature_used", { feature: "lost" })
    const droppedAfterFailure = transport.droppedEvents()
    rmSync(dir)

    // when
    capture(transport, "feature_used", { feature: "kept" })
    await transport.flush()

    // then
    expect(droppedAfterFailure).toBe(1)
    const records = calls.flatMap((c) => logRecordsOf(decodeLogs(c.body))).map((r) => [r.eventName, attributeMap(r.attributes)] as const)
    expect(records.filter(([name]) => name === "omo.client_dropped").map(([, a]) => [a["omo.dropped.reason"], a["omo.dropped.count"]])).toEqual([["write_failed", 1]])
    expect(records.filter(([name]) => name === "omo.feature_used").map(([, a]) => a["omo.feature"])).toEqual(["kept"])
  })
})
