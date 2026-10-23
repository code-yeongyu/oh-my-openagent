import { afterEach, describe, expect, test } from "bun:test"
import { join } from "node:path"

import { context, propagation, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api"
import { logs } from "@opentelemetry/api-logs"

import { createTelemetryProviders, getActiveTraceContext } from "./otel-providers"
import { createTelemetryResource } from "./otel-resource"
import { readSpoolRequest } from "./otlp-spool-file"
import { attributeMap, createSpoolRoot, decodeLogs, decodeTraces, logRecordsOf, TEST_SCOPE, TEST_SPANS, testResource } from "./otlp-test-support"

const roots: (() => void)[] = []
afterEach(() => {
  for (const cleanup of roots.splice(0)) cleanup()
})

function providers() {
  const root = createSpoolRoot("telemetry-core-otel-")
  roots.push(root.cleanup)
  const created = createTelemetryProviders({ resource: testResource(), scope: TEST_SCOPE, spoolDir: root.dir, spans: TEST_SPANS })
  return { root, created }
}

function sealAndRead(created: ReturnType<typeof providers>["created"], dir: string, signal: "logs" | "traces") {
  const writer = signal === "logs" ? created.logWriter : created.spanWriter
  const sealed = writer.seal("018f0000-0000-7000-8000-000000000000")
  if (sealed === null) throw new Error("nothing to seal")
  const request = readSpoolRequest(join(dir, sealed))
  if (request.kind !== "ok") throw new Error("corrupt spool file")
  return request.body
}

describe("createTelemetryProviders", () => {
  test("#given a log emitted inside an active span, also after an await #then the record carries that span's trace and span id", async () => {
    // given
    const { root, created } = providers()

    // when
    await created.tracer.startActiveSpan("omo.turn", async (span) => {
      await Bun.file(import.meta.path).text()
      created.logger.emit({ eventName: "omo.turn_completed", attributes: { "log.record.uid": "a" } })
      expect(getActiveTraceContext()).toEqual({ traceId: span.spanContext().traceId, spanId: span.spanContext().spanId })
      span.end()
    })

    // then
    const span = decodeTraces(sealAndRead(created, root.dir, "traces")).resourceSpans[0]?.scopeSpans[0]?.spans[0]
    const record = logRecordsOf(decodeLogs(sealAndRead(created, root.dir, "logs")))[0]
    expect(span?.name).toBe("omo.turn")
    expect(record?.eventName).toBe("omo.turn_completed")
    expect(Buffer.from(record?.traceId ?? []).toString("hex")).toBe(Buffer.from(span?.traceId ?? []).toString("hex"))
    expect(Buffer.from(record?.spanId ?? []).toString("hex")).toBe(Buffer.from(span?.spanId ?? []).toString("hex"))
  })

  test("#given an inherited traceparent with flags -00 #when a span starts under it #then it is still recorded (AlwaysOn) and keeps the parent ids", () => {
    // given
    const { root, created } = providers()
    const parentTrace = "4bf92f3577b34da6a3ce929d0e0e4736"
    const inbound = propagation.extract(ROOT_CONTEXT, { traceparent: `00-${parentTrace}-00f067aa0ba902b7-00` })

    // when
    created.tracer.startSpan("omo.turn", {}, inbound).end()

    // then
    const span = decodeTraces(sealAndRead(created, root.dir, "traces")).resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(Buffer.from(span?.traceId ?? []).toString("hex")).toBe(parentTrace)
    expect(Buffer.from(span?.parentSpanId ?? []).toString("hex")).toBe("00f067aa0ba902b7")
    expect(span?.flags).toBe(1)
  })

  test("#given span events, links, a status message and an exception #when the span ends #then only the status code travels", () => {
    // given
    const { root, created } = providers()

    // when
    const span = created.tracer.startSpan("omo.turn")
    span.addEvent("private", { text: "x" })
    span.recordException(new Error("secret message"))
    span.setStatus({ code: SpanStatusCode.ERROR, message: "secret message" })
    span.end()

    // then
    const encoded = decodeTraces(sealAndRead(created, root.dir, "traces")).resourceSpans[0]?.scopeSpans[0]?.spans[0]
    expect(encoded?.events).toEqual([])
    expect(encoded?.links).toEqual([])
    expect(encoded?.status?.code).toBe(2)
    expect(encoded?.status?.message).toBe("")
  })

  test("#given providers are created #then no global tracer or logger provider is registered, only context and propagation", () => {
    // given
    const { created } = providers()

    // when
    const globalTracer = trace.getTracer("probe")
    const globalLogger = logs.getLogger("probe")

    // then
    expect(globalTracer).not.toBe(created.tracer)
    expect(globalLogger).not.toBe(created.logger)
    expect(globalTracer.startSpan("x").isRecording()).toBe(false)
    expect(propagation.fields()).toContain("traceparent")
    expect(context.active()).toBeDefined()
  })

  test("#given Node attribution #when the Resource is built #then it uses the D-P keys, OTLP value spellings and the in-house SDK name", () => {
    // when
    const resource = createTelemetryResource({
      serviceName: "omo-senpi",
      serviceVersion: "1.2.3",
      instanceId: "0123456789abcdef0123456789abcdef",
      installHash: "cd".repeat(32),
      platform: "win32",
      osVersion: "10.0.22631",
      arch: "x64",
      schemaVersion: 3,
      surface: "cli",
      ci: false,
    })

    // then
    expect(resource).toEqual({
      "service.name": "omo-senpi",
      "service.version": "1.2.3",
      "service.instance.id": "0123456789abcdef0123456789abcdef",
      "omo.install.hash": "cd".repeat(32),
      "os.type": "windows",
      "os.version": "10.0.22631",
      "host.arch": "amd64",
      "telemetry.sdk.name": "omo-otel-minimal",
      "telemetry.sdk.language": "nodejs",
      "telemetry.sdk.version": "1.0.0",
      "omo.schema.version": 3,
      "omo.surface": "cli",
      "omo.ci": false,
    })
  })

  test("#given a sealed file #then its request carries the writer's Resource and scope from the header", () => {
    // given
    const { root, created } = providers()
    created.logger.emit({ eventName: "omo.x", attributes: { "omo.a": 1 } })

    // when
    const request = decodeLogs(sealAndRead(created, root.dir, "logs"))

    // then
    expect(attributeMap(request.resourceLogs[0]?.resource?.attributes ?? [])["service.version"]).toBe("1.1.0")
    expect(request.resourceLogs[0]?.scopeLogs[0]?.scope?.name).toBe("omo-senpi")
    expect(attributeMap(logRecordsOf(request)[0]?.attributes ?? [])).toEqual({ "omo.a": 1 })
  })
})
