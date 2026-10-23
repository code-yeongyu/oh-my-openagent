import { afterEach, describe, expect, test } from "bun:test"

import { capture, createSpoolRoot, decodeLogs, decodeTraces, logRecordsOf, makeTransport, recordingFetch } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function root(): string {
  const created = createSpoolRoot("telemetry-core-wire-keys-")
  roots.push(created.cleanup)
  return created.dir
}

describe("one key rule for every record on the wire", () => {
  test("#given $ keys and Resource or relay keys passed to capture() and the tracer #then \$ keys and Resource or relay keys never reach the wire", async () => {
    // given
    const dir = root()
    const { calls, fetch } = recordingFetch()
    const transport = makeTransport(dir, { fetch })

    // when
    capture(transport, "feature_used", { $session_id: "s", event_id: "e", install_hash: "h", feature: "direct" })
    transport.tracer.startSpan("omo.turn", {
      attributes: { "$ip": "192.0.2.1", platform: "darwin", "gen_ai.request.model": "m" },
    }).end()
    await transport.flush()

    // then
    const logs = calls.filter((c) => c.url.endsWith("/v1/logs")).flatMap((c) => logRecordsOf(decodeLogs(c.body)))
    const spans = calls.filter((c) => c.url.endsWith("/v1/traces")).flatMap((c) => decodeTraces(c.body).resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)))
    expect(logs.flatMap((r) => r.attributes.map((kv) => kv.key))).toEqual(["omo.feature", "log.record.uid", "session.id"])
    expect(spans.flatMap((s) => s.attributes.map((kv) => kv.key))).toEqual(["gen_ai.request.model"])
  })
})
