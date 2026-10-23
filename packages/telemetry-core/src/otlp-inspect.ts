import { fromBinary } from "@bufbuild/protobuf"

import { ExportLogsServiceRequestSchema } from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"
import { ExportTraceServiceRequestSchema } from "./otlp-proto/opentelemetry/proto/collector/trace/v1/trace_service_pb.js"
import type { AnyValue, KeyValue } from "./otlp-proto/opentelemetry/proto/common/v1/common_pb.js"
import { Span_SpanKind, Status_StatusCode } from "./otlp-proto/opentelemetry/proto/trace/v1/trace_pb.js"
import type { Signal } from "./otlp-spool-file"

export type InspectedValue = string | number | boolean | undefined
export type InspectedAttributes = Readonly<Record<string, InspectedValue>>

export type InspectedLogRecord = {
  readonly eventName: string
  readonly traceId: string | undefined
  readonly spanId: string | undefined
  readonly attributes: InspectedAttributes
}

export type InspectedSpan = {
  readonly name: string
  readonly kind: "unspecified" | "internal" | "server" | "client" | "producer" | "consumer"
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string | undefined
  readonly status: "unset" | "ok" | "error"
  readonly startTimeUnixNano: bigint
  readonly endTimeUnixNano: bigint
  readonly attributes: InspectedAttributes
}

const KINDS: Readonly<Record<Span_SpanKind, InspectedSpan["kind"]>> = {
  [Span_SpanKind.UNSPECIFIED]: "unspecified",
  [Span_SpanKind.INTERNAL]: "internal",
  [Span_SpanKind.SERVER]: "server",
  [Span_SpanKind.CLIENT]: "client",
  [Span_SpanKind.PRODUCER]: "producer",
  [Span_SpanKind.CONSUMER]: "consumer",
}

const STATUSES: Readonly<Record<Status_StatusCode, InspectedSpan["status"]>> = {
  [Status_StatusCode.UNSET]: "unset",
  [Status_StatusCode.OK]: "ok",
  [Status_StatusCode.ERROR]: "error",
}

function hex(bytes: Uint8Array): string | undefined {
  return bytes.byteLength === 0 ? undefined : Buffer.from(bytes).toString("hex")
}

function value(any: AnyValue | undefined): InspectedValue {
  const v = any?.value
  if (v === undefined) return undefined
  if (v.case === "intValue") return Number(v.value)
  if (v.case === "stringValue" || v.case === "boolValue" || v.case === "doubleValue") return v.value
  return undefined
}

function attributes(list: readonly KeyValue[]): InspectedAttributes {
  return Object.fromEntries(list.map((kv) => [kv.key, value(kv.value)]))
}

/**
 * Decodes one OTLP/HTTP protobuf request body into plain records with lowercase hex ids, so a QA sink
 * or a test can read what the transport sent without depending on the generated message classes.
 */
export function inspectOtlpRequest(
  signal: Signal,
  body: Uint8Array,
): { readonly logs: InspectedLogRecord[]; readonly spans: InspectedSpan[] } {
  if (signal === "logs") {
    const request = fromBinary(ExportLogsServiceRequestSchema, body)
    const logs = request.resourceLogs.flatMap((rl) => rl.scopeLogs.flatMap((sl) => sl.logRecords)).map((record) => ({
      eventName: record.eventName,
      traceId: hex(record.traceId),
      spanId: hex(record.spanId),
      attributes: attributes(record.attributes),
    }))
    return { logs, spans: [] }
  }
  const request = fromBinary(ExportTraceServiceRequestSchema, body)
  const spans = request.resourceSpans.flatMap((rs) => rs.scopeSpans.flatMap((ss) => ss.spans)).map((span) => ({
    name: span.name,
    kind: KINDS[span.kind],
    traceId: hex(span.traceId) ?? "",
    spanId: hex(span.spanId) ?? "",
    parentSpanId: hex(span.parentSpanId),
    status: STATUSES[span.status?.code ?? Status_StatusCode.UNSET],
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: attributes(span.attributes),
  }))
  return { logs: [], spans }
}
