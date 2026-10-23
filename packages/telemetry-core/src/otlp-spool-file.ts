import { readFileSync } from "node:fs"

import { create, fromBinary, toBinary } from "@bufbuild/protobuf"

import { encodeResource, encodeScope, type ResourceAttributes } from "./otlp-encode"
import type { InstrumentationScope } from "./otel-time"
import { ExportLogsServiceRequestSchema } from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"
import { ExportTraceServiceRequestSchema } from "./otlp-proto/opentelemetry/proto/collector/trace/v1/trace_service_pb.js"
import { LogRecordSchema, ResourceLogsSchema } from "./otlp-proto/opentelemetry/proto/logs/v1/logs_pb.js"
import { ResourceSpansSchema, SpanSchema } from "./otlp-proto/opentelemetry/proto/trace/v1/trace_pb.js"

/**
 * One spool file is a self-contained OTLP envelope (D-H): a sequence of little-endian u32
 * length-prefixed frames whose first frame is the header `[format][signal]` + a ResourceLogs /
 * ResourceSpans message carrying only the writer's Resource and InstrumentationScope. A replayer
 * builds the request from the FILE's header, never from its own attribution.
 */

export const SPOOL_FORMAT = 1
export type Signal = "logs" | "traces"
const SIGNAL_BYTE: Readonly<Record<Signal, number>> = { logs: 1, traces: 2 }

export function frame(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + payload.byteLength)
  new DataView(out.buffer).setUint32(0, payload.byteLength, true)
  out.set(payload, 4)
  return out
}

export function encodeHeader(signal: Signal, resource: ResourceAttributes, scope: InstrumentationScope): Uint8Array {
  const body = signal === "logs"
    ? toBinary(ResourceLogsSchema, create(ResourceLogsSchema, {
      resource: encodeResource(resource),
      scopeLogs: [{ scope: encodeScope(scope) }],
    }))
    : toBinary(ResourceSpansSchema, create(ResourceSpansSchema, {
      resource: encodeResource(resource),
      scopeSpans: [{ scope: encodeScope(scope) }],
    }))
  const out = new Uint8Array(2 + body.byteLength)
  out[0] = SPOOL_FORMAT
  out[1] = SIGNAL_BYTE[signal]
  out.set(body, 2)
  return out
}

/** Every complete frame in order; a torn tail frame (a crash mid-append) is ignored, never misread. */
export function readFrames(bytes: Uint8Array): Uint8Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const frames: Uint8Array[] = []
  let at = 0
  while (at + 4 <= bytes.byteLength) {
    const length = view.getUint32(at, true)
    if (at + 4 + length > bytes.byteLength) break
    frames.push(bytes.subarray(at + 4, at + 4 + length))
    at += 4 + length
  }
  return frames
}

export type SpoolRequest =
  | { readonly kind: "ok"; readonly signal: Signal; readonly records: number; readonly body: Uint8Array }
  | { readonly kind: "corrupt"; readonly records: number }

function headerSignal(header: Uint8Array | undefined): Signal | undefined {
  if (header === undefined || header.byteLength < 2 || header[0] !== SPOOL_FORMAT) return undefined
  if (header[1] === SIGNAL_BYTE.logs) return "logs"
  if (header[1] === SIGNAL_BYTE.traces) return "traces"
  return undefined
}

function looksLikeHeader(first: Uint8Array | undefined): boolean {
  return first !== undefined && first.byteLength >= 2 && (first[1] === SIGNAL_BYTE.logs || first[1] === SIGNAL_BYTE.traces)
}

function buildBody(signal: Signal, header: Uint8Array, records: readonly Uint8Array[]): Uint8Array {
  if (signal === "logs") {
    const resourceLogs = fromBinary(ResourceLogsSchema, header)
    const scopeLogs = resourceLogs.scopeLogs[0]
    if (scopeLogs === undefined) throw new Error("spool header without scope")
    scopeLogs.logRecords = records.map((record) => fromBinary(LogRecordSchema, record))
    return toBinary(ExportLogsServiceRequestSchema, create(ExportLogsServiceRequestSchema, { resourceLogs: [resourceLogs] }))
  }
  const resourceSpans = fromBinary(ResourceSpansSchema, header)
  const scopeSpans = resourceSpans.scopeSpans[0]
  if (scopeSpans === undefined) throw new Error("spool header without scope")
  scopeSpans.spans = records.map((record) => fromBinary(SpanSchema, record))
  return toBinary(ExportTraceServiceRequestSchema, create(ExportTraceServiceRequestSchema, { resourceSpans: [resourceSpans] }))
}

export function spoolRequest(bytes: Uint8Array): SpoolRequest {
  const [first, ...rest] = readFrames(bytes)
  const signal = headerSignal(first)
  if (first === undefined || signal === undefined) {
    return { kind: "corrupt", records: looksLikeHeader(first) ? rest.length : rest.length + (first === undefined ? 0 : 1) }
  }
  try {
    return { kind: "ok", signal, records: rest.length, body: buildBody(signal, first.subarray(2), rest) }
  } catch {
    return { kind: "corrupt", records: rest.length }
  }
}

export function readSpoolRequest(path: string): SpoolRequest {
  return spoolRequest(new Uint8Array(readFileSync(path)))
}

export function countSpoolRecords(path: string): number {
  try {
    const frames = readFrames(new Uint8Array(readFileSync(path)))
    return looksLikeHeader(frames[0]) ? Math.max(frames.length - 1, 0) : frames.length
  } catch {
    return 0
  }
}
