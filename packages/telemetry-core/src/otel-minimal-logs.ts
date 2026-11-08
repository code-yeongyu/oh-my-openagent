import { context as apiContext, isSpanContextValid, trace, type SpanContext } from "@opentelemetry/api"
import type { AnyValue, LogAttributes, LogRecord, Logger, LoggerProvider } from "@opentelemetry/api-logs"

import { MAX_ATTRIBUTES, systemClock, toUnixNanos, type OtelClock, type UnixNanos } from "./otel-time"

export type ReadableLogRecord = {
  readonly timeUnixNano: UnixNanos
  readonly observedTimeUnixNano: UnixNanos
  readonly eventName: string
  readonly severityNumber: number
  readonly severityText: string
  readonly body: AnyValue | undefined
  readonly attributes: LogAttributes
  readonly droppedAttributesCount: number
  readonly spanContext: SpanContext | undefined
}

export type LogRecordProcessor = {
  readonly onEmit: (record: ReadableLogRecord) => void
  readonly shutdown: () => void
}

class MinimalLogger implements Logger {
  readonly #provider: MinimalLoggerProvider

  constructor(provider: MinimalLoggerProvider) {
    this.#provider = provider
  }

  emit(record: LogRecord): void {
    if (this.#provider.isShutdown) return
    const clock = this.#provider.clock
    const spanContext = trace.getSpanContext(record.context ?? apiContext.active())
    const attributes: Record<string, AnyValue> = {}
    let dropped = 0
    for (const [key, value] of Object.entries(record.attributes ?? {})) {
      if (value === undefined) continue
      if (Object.keys(attributes).length >= MAX_ATTRIBUTES) {
        dropped += 1
        continue
      }
      attributes[key] = value
    }
    this.#provider.processor.onEmit({
      timeUnixNano: toUnixNanos(record.timestamp, clock),
      observedTimeUnixNano: toUnixNanos(record.observedTimestamp, clock),
      eventName: record.eventName ?? "",
      severityNumber: record.severityNumber ?? 0,
      severityText: record.severityText ?? "",
      body: record.body,
      attributes,
      droppedAttributesCount: dropped,
      spanContext: spanContext !== undefined && isSpanContextValid(spanContext) ? spanContext : undefined,
    })
  }

  enabled(): boolean {
    return !this.#provider.isShutdown
  }
}

export class MinimalLoggerProvider implements LoggerProvider {
  readonly processor: LogRecordProcessor
  readonly clock: OtelClock
  readonly #logger: MinimalLogger
  isShutdown = false

  constructor(input: { readonly processor: LogRecordProcessor; readonly clock?: OtelClock }) {
    this.processor = input.processor
    this.clock = input.clock ?? systemClock
    this.#logger = new MinimalLogger(this)
  }

  getLogger(_name: string, _version?: string): Logger {
    return this.#logger
  }

  shutdown(): void {
    if (this.isShutdown) return
    this.isShutdown = true
    this.processor.shutdown()
  }
}
