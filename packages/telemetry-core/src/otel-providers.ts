import { randomUUID } from "node:crypto"

import { context, propagation, trace, type Tracer } from "@opentelemetry/api"
import type { Logger } from "@opentelemetry/api-logs"
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks"
import { W3CTraceContextPropagator } from "@opentelemetry/core"

import { MinimalLoggerProvider } from "./otel-minimal-logs"
import { MinimalTracerProvider } from "./otel-minimal-trace"
import { systemClock, type InstrumentationScope, type OtelClock } from "./otel-time"
import type { ResourceAttributes } from "./otlp-encode"
import { encodeHeader } from "./otlp-spool-file"
import { SpoolWriter, WalLogRecordProcessor, WalSpanProcessor, type SpanAllowlist } from "./otlp-wal"

export type CreateTelemetryProvidersInput = {
  readonly resource: ResourceAttributes
  readonly scope: InstrumentationScope
  readonly spoolDir: string
  /** Required: the spans the tracer may write and the attributes each may carry; anything else is dropped. */
  readonly spans: SpanAllowlist
  readonly bootId?: string
  readonly pid?: number
  readonly clock?: OtelClock
  readonly consent?: () => boolean
  readonly onAppended?: (writer: SpoolWriter) => void
  readonly onWriteError?: (error: unknown, records: number) => void
}

export type TelemetryProviders = {
  readonly loggerProvider: MinimalLoggerProvider
  readonly tracerProvider: MinimalTracerProvider
  readonly logger: Logger
  readonly tracer: Tracer
  readonly logWriter: SpoolWriter
  readonly spanWriter: SpoolWriter
  readonly resource: ResourceAttributes
  readonly scope: InstrumentationScope
  readonly bootId: string
  readonly shutdown: () => void
}

export type ActiveTraceContext = { readonly traceId: string; readonly spanId: string }

let contextRegistered = false

/** Context propagation is the only global state we register; providers stay local to the transport. */
function registerContextPropagation(): void {
  if (contextRegistered) return
  contextRegistered = true
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable())
  propagation.setGlobalPropagator(new W3CTraceContextPropagator())
}

export function createBootId(): string {
  return randomUUID().replaceAll("-", "")
}

export function createTelemetryProviders(input: CreateTelemetryProvidersInput): TelemetryProviders {
  registerContextPropagation()
  const bootId = input.bootId ?? createBootId()
  const pid = input.pid ?? process.pid
  const consent = input.consent ?? (() => true)
  const onAppended = input.onAppended ?? (() => undefined)
  const onError = input.onWriteError ?? (() => undefined)
  const writer = (signal: "logs" | "traces"): SpoolWriter =>
    new SpoolWriter({
      dir: input.spoolDir,
      signal,
      pid,
      bootId,
      header: encodeHeader(signal, input.resource, input.scope),
      consent,
      onError,
    })
  const logWriter = writer("logs")
  const spanWriter = writer("traces")
  const clock = input.clock ?? systemClock
  const loggerProvider = new MinimalLoggerProvider({ processor: new WalLogRecordProcessor(logWriter, onAppended), clock })
  const tracerProvider = new MinimalTracerProvider({ processor: new WalSpanProcessor(spanWriter, onAppended, input.spans), clock })
  return {
    loggerProvider,
    tracerProvider,
    logger: loggerProvider.getLogger(input.scope.name, input.scope.version),
    tracer: tracerProvider.getTracer(input.scope.name, input.scope.version),
    logWriter,
    spanWriter,
    resource: input.resource,
    scope: input.scope,
    bootId,
    shutdown() {
      loggerProvider.shutdown()
      tracerProvider.shutdown()
    },
  }
}

export function getActiveTraceContext(): ActiveTraceContext | undefined {
  const span = trace.getSpanContext(context.active())
  return span === undefined || !trace.isSpanContextValid(span) ? undefined : { traceId: span.traceId, spanId: span.spanId }
}
