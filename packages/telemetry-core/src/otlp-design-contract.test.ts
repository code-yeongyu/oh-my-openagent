import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { createTelemetryProviders } from "./otel-providers"
import * as entry from "./otlp-entry"
import type { WireAttributes } from "./otlp-config"
import * as runtime from "./otlp-sender"
import { readSpoolRequest } from "./otlp-spool-file"
import type { CreateOtlpTelemetryTransportInput } from "./otlp-transport-types"
import { capture, createSpoolRoot, decodeLogs, decodeTraces, logRecordsOf, makeTransport, recordingFetch, TEST_SCOPE, TEST_SPANS, testResource } from "./otlp-test-support"

// The approved collector plan: the schema artifact is the per-event allowlist and no free-text slot exists on
// the wire. These pin it at every way a record can be produced: capture(), the tracer, and the WAL itself.

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-design-contract-")
  roots.push(created.cleanup)
  return created.dir
}

function sealedLogs(dir: string, emit: (providers: ReturnType<typeof createTelemetryProviders>) => void) {
  const providers = createTelemetryProviders({ resource: testResource(), scope: TEST_SCOPE, spoolDir: dir, spans: TEST_SPANS })
  emit(providers)
  const sealed = providers.logWriter.seal("018f0000-0000-7000-8000-000000000000")
  if (sealed === null) return []
  const request = readSpoolRequest(join(dir, sealed))
  if (request.kind !== "ok") throw new Error("corrupt spool file")
  return logRecordsOf(decodeLogs(request.body))
}

describe("the approved wire contract", () => {
  test("#given a LogRecord written with a body and a severity text #then neither reaches the spool", () => {
    const records = sealedLogs(root(), (providers) => {
      providers.logger.emit({ eventName: "omo.feature_used", body: "free text", severityText: "free text", attributes: { "omo.feature": "direct" } })
    })
    expect(records).toHaveLength(1)
    expect(records[0]?.body).toBeUndefined()
    expect(records[0]?.severityText).toBe("")
  })

  test("#given LogRecords named outside the omo.<event> shape #then none is written", () => {
    const records = sealedLogs(root(), (providers) => {
      providers.logger.emit({ eventName: "/srv/customer/alice/report.txt", attributes: {} })
      providers.logger.emit({ attributes: {} })
    })
    expect(records).toEqual([])
  })

  test("#given a projection that allowlists one property #when capture gets more, $session_id included #then only the allowlisted key travels", async () => {
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, {
      fetch,
      project: (_event, properties): WireAttributes => {
        const feature = properties["feature"]
        return typeof feature === "string" ? { "omo.feature": feature } : {}
      },
    })
    capture(transport, "feature_used", { feature: "a", note: "not in the artifact", $session_id: "raw-session", count: 3 })
    await transport.flush()
    const logs = calls.filter((c) => c.url.endsWith("/v1/logs")).flatMap((c) => logRecordsOf(decodeLogs(c.body)))
    expect(logs.flatMap((r) => r.attributes.map((kv) => kv.key)).filter((key) => key !== "log.record.uid")).toEqual(["omo.feature"])
  })

  test("#given spans through the tracer #then an unlisted span is dropped and a listed one keeps only its listed attributes", async () => {
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })
    transport.tracer.startSpan("/home/alice/secret-project", { attributes: { "gen_ai.request.model": "m" } }).end()
    transport.tracer.startSpan("omo.turn", { attributes: { "gen_ai.request.model": "m", "omo.prompt_text": "free text" } }).end()
    await transport.flush()
    const spans = calls.filter((c) => c.url.endsWith("/v1/traces")).flatMap((c) => decodeTraces(c.body).resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)))
    expect(spans.map((span) => [span.name, span.attributes.map((kv) => kv.key)])).toEqual([["omo.turn", ["gen_ai.request.model"]]])
  })

  test("#then no fail-open default exists: the projection and the span allowlist are required and nothing exports a default", () => {
    const requiresProject: undefined extends CreateOtlpTelemetryTransportInput["project"] ? false : true = true
    const requiresSpans: undefined extends CreateOtlpTelemetryTransportInput["spans"] ? false : true = true
    expect([requiresProject, requiresSpans]).toEqual([true, true])
    expect("defaultWireProjection" in entry || "defaultWireProjection" in runtime).toBe(false)
  })
})
