import { afterEach, describe, expect, test } from "bun:test"

import { context, ROOT_CONTEXT, trace, TraceFlags } from "@opentelemetry/api"

import { TURN_SPAN_NAME } from "./otel-turn-span"
import type { OtlpTelemetryTransport } from "./otlp-transport-types"
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

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

const hex = (bytes: Uint8Array | undefined): string => Buffer.from(bytes ?? new Uint8Array()).toString("hex")

function setup(consent: () => boolean = () => true) {
  const root = createSpoolRoot("telemetry-core-turn-")
  roots.push(root.cleanup)
  const recorder = recordingFetch()
  const spans = { "omo.turn": [...Object.keys(TURN_ATTRIBUTES), "gen_ai.response.model"] }
  const transport = makeTransport(root.dir, { fetch: recorder.fetch, consent, spans })
  return { transport, recorder }
}

async function sent(transport: OtlpTelemetryTransport, recorder: ReturnType<typeof recordingFetch>) {
  await transport.flush()
  const logs = recorder.calls.filter(({ url }) => url.endsWith("/v1/logs")).flatMap(({ body }) => logRecordsOf(decodeLogs(body)))
  const spans = recorder.calls
    .filter(({ url }) => url.endsWith("/v1/traces"))
    .flatMap(({ body }) => decodeTraces(body).resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)))
  return {
    logs: logs.map((record) => ({
      event: record.eventName,
      traceId: hex(record.traceId),
      spanId: hex(record.spanId),
      attributes: attributeMap(record.attributes),
    })),
    spans: spans.map((span) => ({
      name: span.name,
      traceId: hex(span.traceId),
      spanId: hex(span.spanId),
      parentSpanId: hex(span.parentSpanId),
      flags: span.flags,
      kind: span.kind,
      status: span.status?.code ?? 0,
      durationNs: span.endTimeUnixNano - span.startTimeUnixNano,
      attributes: attributeMap(span.attributes),
    })),
  }
}

const TURN_ATTRIBUTES = {
  "gen_ai.operation.name": "chat",
  "session.id": "session-hash",
  "omo.session.role": "main",
  "omo.turn.index": 0,
} as const

describe("turn tracing on the OTLP transport", () => {
  test("#given a turn #when an event is captured inside it and another after it ended #then one omo.turn span is exported and only the in-turn event carries its exact pair", async () => {
    // given
    const { transport, recorder } = setup()
    const turn = transport.traces.startTurn({ attributes: TURN_ATTRIBUTES })
    if (turn === undefined) throw new Error("turn span not started")

    // when
    turn.run(() => capture(transport, "turn_completed", { turn_index: 0 }))
    turn.setAttributes({ "gen_ai.response.model": "gpt-5.6-sol" })
    turn.end("ok")
    capture(transport, "session_summary", { turns: 1 })

    // then
    const { logs, spans } = await sent(transport, recorder)
    expect(turn.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(turn.spanId).toMatch(/^[0-9a-f]{16}$/)
    expect(turn.traceparent).toBe(`00-${turn.traceId}-${turn.spanId}-01`)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      name: TURN_SPAN_NAME,
      traceId: turn.traceId,
      spanId: turn.spanId,
      parentSpanId: "",
      kind: 1,
      status: 1,
      attributes: { ...TURN_ATTRIBUTES, "gen_ai.response.model": "gpt-5.6-sol" },
    })
    expect(spans[0]?.durationNs).toBeGreaterThanOrEqual(0n)
    expect(logs.map(({ event, traceId, spanId }) => ({ event, traceId, spanId }))).toEqual([
      { event: "omo.turn_completed", traceId: turn.traceId, spanId: turn.spanId },
      { event: "omo.session_summary", traceId: "", spanId: "" },
    ])
  })

  test("#given a turn that fails #when it ends with error #then the span status is error and its event keeps the pair", async () => {
    // given
    const { transport, recorder } = setup()
    const turn = transport.traces.startTurn({ attributes: TURN_ATTRIBUTES })
    if (turn === undefined) throw new Error("turn span not started")

    // when
    turn.run(() => capture(transport, "turn_completed", { turn_index: 0 }))
    turn.end("error")
    turn.end("ok")

    // then
    const { logs, spans } = await sent(transport, recorder)
    expect(spans.map(({ status }) => status)).toEqual([2])
    expect(logs[0]).toMatchObject({ traceId: turn.traceId, spanId: turn.spanId })
  })

  test("#given a LOCAL parent whose sampled flag is clear #when a turn starts under it #then the span is still exported with that parent and the event keeps the exact pair", async () => {
    // given
    const { transport, recorder } = setup()
    const parent = { traceId: "4bf92f3577b34da6a3ce929d0e0e4736", spanId: "00f067aa0ba902b7", traceFlags: TraceFlags.NONE }

    // when
    const turn = context.with(trace.setSpanContext(ROOT_CONTEXT, parent), () => transport.traces.startTurn({ attributes: TURN_ATTRIBUTES }))
    if (turn === undefined) throw new Error("turn span not started")
    turn.run(() => capture(transport, "turn_completed", { turn_index: 0 }))
    turn.end("ok")

    // then
    const { logs, spans } = await sent(transport, recorder)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ traceId: parent.traceId, parentSpanId: parent.spanId, flags: 1, spanId: turn.spanId })
    expect(turn.spanId).not.toBe(parent.spanId)
    expect(logs[0]).toMatchObject({ traceId: parent.traceId, spanId: turn.spanId })
  })

  test("#given a REMOTE parent traceparent ending in -00 #when a turn starts from it through the propagator #then the span is still exported with that parent and the event keeps the exact pair", async () => {
    // given
    const { transport, recorder } = setup()
    const parentTrace = "0af7651916cd43dd8448eb211c80319c"
    const parentSpan = "b7ad6b7169203331"

    // when
    const turn = transport.traces.startTurn({
      attributes: TURN_ATTRIBUTES,
      parentTraceparent: `00-${parentTrace}-${parentSpan}-00`,
    })
    if (turn === undefined) throw new Error("turn span not started")
    turn.run(() => capture(transport, "turn_completed", { turn_index: 0 }))
    turn.end("ok")

    // then
    const { logs, spans } = await sent(transport, recorder)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ traceId: parentTrace, parentSpanId: parentSpan, flags: 1 })
    expect(logs[0]).toMatchObject({ traceId: parentTrace, spanId: turn.spanId })
  })

  test("#given a malformed inherited traceparent #when a turn starts #then it becomes a root span", async () => {
    // given
    const { transport, recorder } = setup()

    // when
    const turn = transport.traces.startTurn({
      attributes: TURN_ATTRIBUTES,
      parentTraceparent: "00-00000000000000000000000000000000-b7ad6b7169203331-01",
    })
    turn?.end("ok")

    // then
    const { spans } = await sent(transport, recorder)
    expect(spans).toHaveLength(1)
    expect(spans[0]?.parentSpanId).toBe("")
  })

  test("#given two turns running at once #when each captures after an await and a timer #then the spans never share an id and each event carries its own turn's pair", async () => {
    // given
    const { transport, recorder } = setup()
    const first = transport.traces.startTurn({ attributes: { ...TURN_ATTRIBUTES, "session.id": "a" } })
    const second = transport.traces.startTurn({ attributes: { ...TURN_ATTRIBUTES, "session.id": "b" } })
    if (first === undefined || second === undefined) throw new Error("turn span not started")
    const { promise: gate, resolve: open } = Promise.withResolvers<void>()

    // when
    const runs = [first, second].map((turn, index) =>
      turn.run(async () => {
        await gate
        await new Promise<void>((resolve) => {
          setTimeout(() => {
            capture(transport, "feature_used", { feature: `f${index}` })
            resolve()
          }, 0)
        })
      }),
    )
    open()
    await Promise.all(runs)
    first.end("ok")
    second.end("ok")

    // then
    const { logs, spans } = await sent(transport, recorder)
    expect(first.spanId).not.toBe(second.spanId)
    expect(new Set(spans.map(({ spanId }) => spanId)).size).toBe(2)
    expect(logs.map(({ attributes, spanId }) => [attributes["omo.feature"], spanId])).toEqual([
      ["f0", first.spanId],
      ["f1", second.spanId],
    ])
  })

  test("#given consent is withdrawn #when a turn would start #then no span is started and nothing reaches the traces endpoint", async () => {
    // given
    let consented = true
    const { transport, recorder } = setup(() => consented)
    consented = false

    // when
    const turn = transport.traces.startTurn({ attributes: TURN_ATTRIBUTES })
    consented = true
    const { spans } = await sent(transport, recorder)

    // then
    expect(turn).toBeUndefined()
    expect(spans).toEqual([])
  })

  test("#given the transport has shut down #when a turn would start #then no span is started", async () => {
    // given
    const { transport } = setup()
    await transport.shutdown()

    // when
    const turn = transport.traces.startTurn({ attributes: TURN_ATTRIBUTES })

    // then
    expect(turn).toBeUndefined()
  })
})
