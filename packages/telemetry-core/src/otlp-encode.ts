import { create } from "@bufbuild/protobuf"
import { SpanKind, SpanStatusCode } from "@opentelemetry/api"
import type { AnyValue as ApiAnyValue } from "@opentelemetry/api-logs"

import type { ReadableLogRecord } from "./otel-minimal-logs"
import type { ReadableSpan } from "./otel-minimal-trace"
import type { InstrumentationScope } from "./otel-time"
import {
  AnyValueSchema,
  InstrumentationScopeSchema,
  KeyValueSchema,
  type AnyValue,
  type KeyValue,
} from "./otlp-proto/opentelemetry/proto/common/v1/common_pb.js"
import {
  LogRecordSchema,
  SeverityNumber,
  type LogRecord,
} from "./otlp-proto/opentelemetry/proto/logs/v1/logs_pb.js"
import { ResourceSchema, type Resource } from "./otlp-proto/opentelemetry/proto/resource/v1/resource_pb.js"
import {
  Span_SpanKind,
  SpanSchema,
  Status_StatusCode,
  StatusSchema,
  type Span,
} from "./otlp-proto/opentelemetry/proto/trace/v1/trace_pb.js"

export type ResourceAttributes = Readonly<Record<string, string | number | boolean>>

const SPAN_KINDS: Readonly<Record<SpanKind, Span_SpanKind>> = {
  [SpanKind.INTERNAL]: Span_SpanKind.INTERNAL,
  [SpanKind.SERVER]: Span_SpanKind.SERVER,
  [SpanKind.CLIENT]: Span_SpanKind.CLIENT,
  [SpanKind.PRODUCER]: Span_SpanKind.PRODUCER,
  [SpanKind.CONSUMER]: Span_SpanKind.CONSUMER,
}

const STATUS_CODES: Readonly<Record<SpanStatusCode, Status_StatusCode>> = {
  [SpanStatusCode.UNSET]: Status_StatusCode.UNSET,
  [SpanStatusCode.OK]: Status_StatusCode.OK,
  [SpanStatusCode.ERROR]: Status_StatusCode.ERROR,
}

const SEVERITIES: readonly SeverityNumber[] = Object.values(SeverityNumber)

function severity(value: number): SeverityNumber {
  return SEVERITIES.find((known) => known === value) ?? SeverityNumber.UNSPECIFIED
}

export function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

const INT64_MIN = -(2 ** 63)
const INT64_LIMIT = 2 ** 63

function anyValue(value: ApiAnyValue): AnyValue {
  if (typeof value === "string") return create(AnyValueSchema, { value: { case: "stringValue", value } })
  if (typeof value === "boolean") return create(AnyValueSchema, { value: { case: "boolValue", value } })
  if (typeof value === "number") {
    // An integer outside int64 (or past 2^63, which a double rounds onto) has no int_value form.
    return Number.isInteger(value) && value >= INT64_MIN && value < INT64_LIMIT
      ? create(AnyValueSchema, { value: { case: "intValue", value: BigInt(value) } })
      : create(AnyValueSchema, { value: { case: "doubleValue", value } })
  }
  if (value instanceof Uint8Array) return create(AnyValueSchema, { value: { case: "bytesValue", value } })
  if (Array.isArray(value)) {
    return create(AnyValueSchema, { value: { case: "arrayValue", value: { values: value.map(anyValue) } } })
  }
  if (value !== null && value !== undefined && typeof value === "object") {
    return create(AnyValueSchema, { value: { case: "kvlistValue", value: { values: keyValues(value) } } })
  }
  return create(AnyValueSchema, {})
}

export function keyValues(attributes: Readonly<Record<string, ApiAnyValue>>): KeyValue[] {
  return Object.entries(attributes).flatMap(([key, value]) =>
    value === undefined ? [] : [create(KeyValueSchema, { key, value: anyValue(value) })],
  )
}

export function encodeResource(attributes: ResourceAttributes): Resource {
  return create(ResourceSchema, { attributes: keyValues(attributes) })
}

export function encodeScope(scope: InstrumentationScope) {
  return create(InstrumentationScopeSchema, { name: scope.name, version: scope.version })
}

export function encodeLogRecord(record: ReadableLogRecord): LogRecord {
  const span = record.spanContext
  return create(LogRecordSchema, {
    timeUnixNano: record.timeUnixNano,
    observedTimeUnixNano: record.observedTimeUnixNano,
    severityNumber: severity(record.severityNumber),
    severityText: record.severityText,
    eventName: record.eventName,
    attributes: keyValues(record.attributes),
    droppedAttributesCount: record.droppedAttributesCount,
    ...(record.body === undefined ? {} : { body: anyValue(record.body) }),
    ...(span === undefined
      ? {}
      : { traceId: hexToBytes(span.traceId), spanId: hexToBytes(span.spanId), flags: span.traceFlags & 0xff }),
  })
}

export function encodeSpan(span: ReadableSpan): Span {
  return create(SpanSchema, {
    traceId: hexToBytes(span.spanContext.traceId),
    spanId: hexToBytes(span.spanContext.spanId),
    parentSpanId: span.parentSpanId === undefined ? new Uint8Array(0) : hexToBytes(span.parentSpanId),
    flags: span.spanContext.traceFlags & 0xff,
    name: span.name,
    kind: SPAN_KINDS[span.kind],
    startTimeUnixNano: span.startTimeUnixNano,
    endTimeUnixNano: span.endTimeUnixNano,
    attributes: keyValues(span.attributes),
    droppedAttributesCount: span.droppedAttributesCount,
    status: create(StatusSchema, { code: STATUS_CODES[span.statusCode] }),
  })
}
