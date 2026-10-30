import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { gunzipSync } from "node:zlib"

import { fromBinary } from "@bufbuild/protobuf"

import { type OtlpWireProjection, type WireAttributes, isWireAttributeKey } from "./otlp-config"
import { createOtlpSender } from "./otlp-sender-core"
import type { CreateOtlpTelemetryTransportInput, OtlpTelemetryTransport } from "./otlp-transport-types"
import type { OtlpFetch } from "./otlp-http"
import {
  ExportLogsServiceRequestSchema,
  type ExportLogsServiceRequest,
} from "./otlp-proto/opentelemetry/proto/collector/logs/v1/logs_service_pb.js"
import {
  ExportTraceServiceRequestSchema,
  type ExportTraceServiceRequest,
} from "./otlp-proto/opentelemetry/proto/collector/trace/v1/trace_service_pb.js"
import type { AnyValue, KeyValue } from "./otlp-proto/opentelemetry/proto/common/v1/common_pb.js"

export const TEST_SCOPE = { name: "omo-senpi", version: "3.17.0" } as const

/** Test stand-in for a schema artifact's span allowlist. */
export const TEST_SPANS = { "omo.turn": ["gen_ai.request.model", "n", "nan"] } as const

/**
 * Test stand-in for a schema artifact's projection: `$session_id` maps to the semconv `session.id`, as the
 * artifact's wire keys do, and every other primitive that passes the key rule becomes `omo.<name>`.
 */
export const testWireProjection: OtlpWireProjection = (_event, properties) => {
  const attributes: WireAttributes = {}
  const session = properties["$session_id"]
  if (typeof session === "string" && session.length > 0) attributes["session.id"] = session
  for (const [key, value] of Object.entries(properties)) {
    if (!isWireAttributeKey(key)) continue
    if (typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      attributes[`omo.${key}`] = value
    }
  }
  return attributes
}

export function testResource(version = "1.1.0"): Readonly<Record<string, string | number | boolean>> {
  return {
    "service.name": "omo-senpi",
    "service.version": version,
    "service.instance.id": "0123456789abcdef0123456789abcdef",
    "omo.install.hash": "ab".repeat(32),
    "telemetry.sdk.name": "omo-otel-minimal",
    "omo.schema.version": 3,
  }
}

export function createSpoolRoot(prefix: string): { readonly dir: string; readonly cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return { dir: join(root, "telemetry-spool"), cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

export function spoolNames(dir: string): string[] {
  try {
    return readdirSync(dir).sort()
  } catch {
    return []
  }
}

export type RecordedRequest = {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly body: Uint8Array
  readonly wireBytes: number
}

export type Responder = (url: string, call: number) => Response | Promise<Response>

export function recordingFetch(respond: Responder = () => new Response(null, { status: 200 })) {
  const calls: RecordedRequest[] = []
  const fetch: OtlpFetch = async (url, init) => {
    const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key, String(value)]))
    const raw = init.body instanceof Uint8Array ? init.body : new Uint8Array(0)
    const body = headers["content-encoding"] === "gzip" ? new Uint8Array(gunzipSync(raw)) : raw
    calls.push({ url, headers, body, wireBytes: raw.byteLength })
    return respond(url, calls.length)
  }
  return { calls, fetch }
}

export function makeTransport(
  dir: string,
  overrides: Partial<CreateOtlpTelemetryTransportInput> = {},
): OtlpTelemetryTransport {
  return createOtlpSender({
    productEnvPrefix: "OMO_TEST",
    ingestKey: "test-ingest-key",
    spoolDir: dir,
    spoolRoot: dirname(dir),
    resource: testResource(),
    scope: TEST_SCOPE,
    env: {},
    endpoint: "https://collector.test",
    autoStart: false,
    sleep: async () => undefined,
    random: () => 0,
    fetch: recordingFetch().fetch,
    project: testWireProjection,
    spans: TEST_SPANS,
    ...overrides,
  })
}

export function decodeLogs(body: Uint8Array): ExportLogsServiceRequest {
  return fromBinary(ExportLogsServiceRequestSchema, body)
}

export function decodeTraces(body: Uint8Array): ExportTraceServiceRequest {
  return fromBinary(ExportTraceServiceRequestSchema, body)
}

export function plain(value: AnyValue | undefined): unknown {
  const v = value?.value
  if (v === undefined) return undefined
  return v.case === "intValue" ? Number(v.value) : v.value
}

export function attributeMap(attributes: readonly KeyValue[]): Record<string, unknown> {
  return Object.fromEntries(attributes.map((kv) => [kv.key, plain(kv.value)]))
}

export function logRecordsOf(request: ExportLogsServiceRequest) {
  return request.resourceLogs.flatMap((rl) => rl.scopeLogs.flatMap((sl) => sl.logRecords))
}

export function capture(transport: OtlpTelemetryTransport, event: string, properties: Record<string, unknown>): void {
  transport.capture({ distinctId: "unused-on-otlp", event, properties })
}
