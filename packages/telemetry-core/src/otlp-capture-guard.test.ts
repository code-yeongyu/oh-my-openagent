import { afterEach, describe, expect, test } from "bun:test"

import {
  attributeMap,
  capture,
  createSpoolRoot,
  decodeLogs,
  decodeTraces,
  logRecordsOf,
  makeTransport,
  recordingFetch,
} from "./otlp-test-support"
import type { TelemetryDiagnosticInput } from "./types"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-guard-")
  roots.push(created.cleanup)
  return created.dir
}

describe("capture never throws into the caller", () => {
  test("#given integers outside int64 and non-finite numbers #then capture returns and the huge integers travel as doubles", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    const run = (): void => {
      capture(transport, "feature_used", { n: 1e20 })
      capture(transport, "feature_used", { n: -1e20 })
      capture(transport, "feature_used", { n: 2 ** 63 })
      capture(transport, "feature_used", { n: Number.MAX_VALUE })
      capture(transport, "feature_used", { n: Number.NaN, m: Number.POSITIVE_INFINITY, k: 2 ** 62 })
    }

    // then
    expect(run).not.toThrow()
    await transport.flush()
    const records = logRecordsOf(decodeLogs(calls[0]?.body ?? new Uint8Array()))
    const values = records.map((record) => record.attributes.find((kv) => kv.key === "omo.n")?.value?.value)
    expect(values.slice(0, 4)).toEqual([
      { case: "doubleValue", value: 1e20 },
      { case: "doubleValue", value: -1e20 },
      { case: "doubleValue", value: 2 ** 63 },
      { case: "doubleValue", value: Number.MAX_VALUE },
    ])
    expect(attributeMap(records[4]?.attributes ?? [])["omo.k"]).toBe(2 ** 62)
  })

  test("#given a log or span attribute outside int64 #then capture and span end return", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    const run = (): void => {
      capture(transport, "feature_used", { n: 1e30 })
      transport.tracer.startSpan("omo.turn", { attributes: { n: -1e30, nan: Number.NaN } }).end()
    }

    // then
    expect(run).not.toThrow()
    await transport.flush()
    const spans = calls.filter((c) => c.url.endsWith("/v1/traces")).flatMap((c) => decodeTraces(c.body).resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)))
    expect(spans[0]?.attributes.find((kv) => kv.key === "n")?.value?.value).toEqual({ case: "doubleValue", value: -1e30 })
  })

  test("#given a product projection that throws #then capture returns and the failure is diagnosed", () => {
    // given
    const diagnostics: TelemetryDiagnosticInput[] = []
    const transport = makeTransport(root(), {
      project: () => {
        throw new Error("bad projection")
      },
      diagnostics: (input) => diagnostics.push(input),
    })

    // when
    const run = (): void => capture(transport, "feature_used", { feature: "a" })

    // then
    expect(run).not.toThrow()
    expect(diagnostics.map((d) => d.event)).toEqual(["telemetry_capture_failed"])
  })
})
