import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { produceFixtureBodies } from "./otlp-fixture-support"
import type { AnyValue, KeyValue } from "./otlp-proto/opentelemetry/proto/common/v1/common_pb.js"
import { createSpoolRoot, decodeLogs } from "./otlp-test-support"

const FIXTURE = JSON.parse(readFileSync(join(import.meta.dir, "../test-fixtures/otlp/shared-logs-fixture.json"), "utf8"))
const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

// The collector's protobuf flattening (omo-telemetry apps/ingest/src/otlp.ts, logs path), so the
// fixture rows recorded from that decoder can be compared here without a cross-repo dependency.
function workerValue(value: AnyValue | undefined): unknown {
  const v = value?.value
  switch (v?.case) {
    case "stringValue":
      return { t: "s", v: v.value }
    case "boolValue":
      return { t: "b", v: v.value }
    case "intValue":
      return { t: "i", v: v.value.toString() }
    case "doubleValue":
      return { t: "d", v: v.value }
    case "arrayValue":
      return { t: "a", n: v.value.values.length }
    case "kvlistValue":
      return { t: "k", n: v.value.values.length }
    case "bytesValue":
      return { t: "x", n: v.value.length }
    default:
      return { t: "e" }
  }
}

const attrs = (list: readonly KeyValue[]) => list.map((kv) => ({ key: kv.key, value: workerValue(kv.value) }))
const id = (bytes: Uint8Array, length: number) =>
  bytes.length === 0 || bytes.every((b) => b === 0)
    ? { kind: "none" }
    : bytes.length === length ? { kind: "hex", hex: Buffer.from(bytes).toString("hex") } : { kind: "bad" }

function workerRows(body: Uint8Array): unknown {
  return {
    signal: "logs",
    groups: decodeLogs(body).resourceLogs.map((rl) => ({
      attributes: attrs(rl.resource?.attributes ?? []),
      droppedAttributesCount: rl.resource?.droppedAttributesCount ?? 0,
      schemaUrl: rl.schemaUrl,
      scopes: rl.scopeLogs.map((sl) => ({
        name: sl.scope?.name ?? "",
        version: sl.scope?.version ?? "",
        attributes: attrs(sl.scope?.attributes ?? []),
        schemaUrl: sl.schemaUrl,
        items: sl.logRecords.map((lr) => ({
          time: lr.timeUnixNano.toString(),
          eventName: lr.eventName,
          body: lr.body === undefined ? null : workerValue(lr.body),
          attributes: attrs(lr.attributes),
          droppedAttributesCount: lr.droppedAttributesCount,
          flags: lr.flags,
          traceId: id(lr.traceId, 16),
          spanId: id(lr.spanId, 8),
        })),
      })),
    })),
  }
}

describe("shared OTLP fixture with the collector", () => {
  test("#given the same events #then the live send and the replay of the spooled file are byte-identical to the collector's fixture request", async () => {
    // given
    const live = createSpoolRoot("telemetry-core-fixture-live-")
    const replay = createSpoolRoot("telemetry-core-fixture-replay-")
    roots.push(live.cleanup, replay.cleanup)

    // when
    const bodies = await produceFixtureBodies(live.dir, replay.dir)

    // then
    const expected = Buffer.from(FIXTURE.request_base64, "base64")
    expect(Buffer.from(bodies.live).equals(expected)).toBe(true)
    expect(Buffer.from(bodies.replay).equals(expected)).toBe(true)
  })

  test("#given the fixture request #then it flattens into exactly the rows the collector's decoder produced", () => {
    // when
    const rows = workerRows(new Uint8Array(Buffer.from(FIXTURE.request_base64, "base64")))

    // then
    expect(rows).toEqual(FIXTURE.worker_decoded)
  })

  test("#given the vendored generated proto code #then every file matches the pinned collector digest (never hand-edited)", () => {
    // given
    const dir = join(import.meta.dir, "otlp-proto")
    const pinned = readFileSync(join(dir, "SHA256SUMS"), "utf8").trim().split("\n")

    // then
    expect(pinned.length).toBe(6)
    for (const line of pinned) {
      const [digest, file] = line.split(/\s+/)
      expect(createHash("sha256").update(readFileSync(join(dir, file ?? ""))).digest("hex")).toBe(digest ?? "")
    }
    expect(readFileSync(join(dir, "PROTO_TAG"), "utf8").trim()).toBe("v1.7.0")
  })
})
