import { afterEach, describe, expect, test } from "bun:test"
import { appendFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

import { readFrames, readSpoolRequest } from "./otlp-spool-file"
import { capture, createSpoolRoot, decodeLogs, logRecordsOf, makeTransport, recordingFetch, spoolNames } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-wal-")
  roots.push(created.cleanup)
  return created.dir
}

describe("write-ahead spool", () => {
  test("#given 3 captured events and no flush #then the active file already holds a header frame and 3 record frames", () => {
    // given
    const dir = root()
    const transport = makeTransport(dir, { pid: 4242, bootId: "f".repeat(32) })

    // when
    for (const index of [1, 2, 3]) capture(transport, "feature_used", { feature: `f${index}` })

    // then
    const active = join(dir, `active-logs-4242-${"f".repeat(32)}.otlp`)
    const frames = readFrames(new Uint8Array(readFileSync(active)))
    expect(frames.length).toBe(4)
    expect(frames[0]?.[0]).toBe(1)
    expect(frames[0]?.[1]).toBe(1)
    const request = readSpoolRequest(active)
    expect(request.kind === "ok" && logRecordsOf(decodeLogs(request.body)).map((r) => r.eventName)).toEqual([
      "omo.feature_used",
      "omo.feature_used",
      "omo.feature_used",
    ])
  })

  test("#given consent is off #when events are captured #then no spool directory or file is ever created", () => {
    // given
    const dir = root()
    const transport = makeTransport(dir, { consent: () => false })

    // when
    for (let index = 0; index < 25; index += 1) capture(transport, "feature_used", { feature: "x" })

    // then
    expect(existsSync(dir)).toBe(false)
  })

  test("#given consent turns off mid-session #when the transport flushes #then this process's spool files are deleted and nothing is sent", async () => {
    // given
    const dir = root()
    let consent = true
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { consent: () => consent, fetch })
    capture(transport, "feature_used", { feature: "a" })
    capture(transport, "feature_used", { feature: "b" })
    capture(transport, "feature_used", { feature: "c" })
    consent = false

    // when
    await transport.flush()

    // then
    expect(spoolNames(dir)).toEqual([])
    expect(calls.length).toBe(0)
  })

  test("#given a torn tail frame from a crash mid-append #then the complete frames are still read and the torn one ignored", () => {
    // given
    const dir = root()
    const transport = makeTransport(dir, { pid: 7, bootId: "e".repeat(32) })
    capture(transport, "feature_used", { feature: "a" })
    const active = join(dir, `active-logs-7-${"e".repeat(32)}.otlp`)
    appendFileSync(active, new Uint8Array([200, 0, 0, 0, 1, 2]))

    // when
    const request = readSpoolRequest(active)

    // then
    expect(request.kind).toBe("ok")
    expect(request.records).toBe(1)
  })

  test("#given an event with event_id and $session_id #then the record carries log.record.uid, session.id and omo.<bare> keys only", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    capture(transport, "feature_used", {
      event_id: "01890000-0000-7000-8000-000000000001",
      $session_id: "aa".repeat(32),
      $os: "darwin",
      platform: "darwin",
      package_version: "1.0.0",
      feature: "eval",
    })
    await transport.flush()

    // then
    const record = logRecordsOf(decodeLogs(calls[0]?.body ?? new Uint8Array()))[0]
    const keys = (record?.attributes ?? []).map((kv) => kv.key).sort()
    expect(keys).toEqual(["log.record.uid", "omo.feature", "session.id"])
    expect(record?.body).toBeUndefined()
  })
})
