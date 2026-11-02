import {
  context as apiContext,
  INVALID_SPAN_CONTEXT,
  isSpanContextValid,
  SpanKind,
  SpanStatusCode,
  trace,
  TraceFlags,
  type Attributes,
  type AttributeValue,
  type Context,
  type Exception,
  type Link,
  type Span,
  type SpanContext,
  type SpanOptions,
  type SpanStatus,
  type TimeInput,
  type Tracer,
  type TracerProvider,
} from "@opentelemetry/api"

import { MAX_ATTRIBUTES, systemClock, toUnixNanos, type OtelClock, type UnixNanos } from "./otel-time"

/**
 * The minimal in-house OpenTelemetry providers (spike 13 (g) fallback): a `LoggerProvider` and a
 * `TracerProvider` behind the unchanged `@opentelemetry/api` + `api-logs` interfaces. The stock SDK
 * exceeded the CLI startup budget, so the engine implements only what the collector contract needs:
 * one instrumentation scope, one processor per signal, an always-on sampler (never ParentBased, so an
 * inherited `-00` traceparent never suppresses a span), no span events, links or status messages.
 * It reads no `OTEL_*` variable; `OTEL_SDK_DISABLED` is honored by the transport as an opt-out.
 */

export type ReadableSpan = {
  readonly name: string
  readonly kind: SpanKind
  readonly spanContext: SpanContext
  readonly parentSpanId: string | undefined
  readonly startTimeUnixNano: UnixNanos
  readonly endTimeUnixNano: UnixNanos
  readonly attributes: Attributes
  readonly droppedAttributesCount: number
  readonly statusCode: SpanStatusCode
}

export type SpanProcessor = {
  readonly onEnd: (span: ReadableSpan) => void
  readonly shutdown: () => void
}

const HEX = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"))

function randomHexId(bytes: number): string {
  const buffer = new Uint8Array(bytes)
  do {
    crypto.getRandomValues(buffer)
  } while (buffer.every((byte) => byte === 0))
  let out = ""
  for (const byte of buffer) out += HEX[byte]
  return out
}

function isAttributeValue(value: unknown): value is AttributeValue {
  if (typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  return Array.isArray(value)
}

class MinimalSpan implements Span {
  readonly #processor: SpanProcessor
  readonly #clock: OtelClock
  readonly #spanContext: SpanContext
  readonly #parentSpanId: string | undefined
  readonly #kind: SpanKind
  readonly #start: UnixNanos
  readonly #attributes: Record<string, AttributeValue> = {}
  #name: string
  #dropped = 0
  #status: SpanStatusCode = SpanStatusCode.UNSET
  #ended = false

  constructor(input: {
    readonly processor: SpanProcessor
    readonly clock: OtelClock
    readonly name: string
    readonly spanContext: SpanContext
    readonly parentSpanId: string | undefined
    readonly kind: SpanKind
    readonly start: UnixNanos
    readonly attributes: Attributes | undefined
  }) {
    this.#processor = input.processor
    this.#clock = input.clock
    this.#name = input.name
    this.#spanContext = input.spanContext
    this.#parentSpanId = input.parentSpanId
    this.#kind = input.kind
    this.#start = input.start
    if (input.attributes !== undefined) this.setAttributes(input.attributes)
  }

  spanContext(): SpanContext {
    return this.#spanContext
  }

  setAttribute(key: string, value: AttributeValue): this {
    if (this.#ended || !isAttributeValue(value)) return this
    if (!(key in this.#attributes) && Object.keys(this.#attributes).length >= MAX_ATTRIBUTES) {
      this.#dropped += 1
      return this
    }
    this.#attributes[key] = value
    return this
  }

  setAttributes(attributes: Attributes): this {
    for (const [key, value] of Object.entries(attributes)) {
      if (value !== undefined) this.setAttribute(key, value)
    }
    return this
  }

  // Span events, links and exception text are not part of the v1 wire contract (D-B): never recorded.
  addEvent(_name: string, _attributesOrStartTime?: Attributes | TimeInput, _startTime?: TimeInput): this {
    return this
  }

  addLink(_link: Link): this {
    return this
  }

  addLinks(_links: Link[]): this {
    return this
  }

  recordException(_exception: Exception, _time?: TimeInput): void {}

  /** Only the code travels; a status message is free text and is never recorded. */
  setStatus(status: SpanStatus): this {
    if (!this.#ended) this.#status = status.code
    return this
  }

  updateName(name: string): this {
    if (!this.#ended) this.#name = name
    return this
  }

  end(endTime?: TimeInput): void {
    if (this.#ended) return
    this.#ended = true
    this.#processor.onEnd({
      name: this.#name,
      kind: this.#kind,
      spanContext: this.#spanContext,
      parentSpanId: this.#parentSpanId,
      startTimeUnixNano: this.#start,
      endTimeUnixNano: toUnixNanos(endTime, this.#clock),
      attributes: { ...this.#attributes },
      droppedAttributesCount: this.#dropped,
      statusCode: this.#status,
    })
  }

  isRecording(): boolean {
    return !this.#ended
  }
}

class MinimalTracer implements Tracer {
  readonly #provider: MinimalTracerProvider

  constructor(provider: MinimalTracerProvider) {
    this.#provider = provider
  }

  startSpan(name: string, options: SpanOptions = {}, context: Context = apiContext.active()): Span {
    if (this.#provider.isShutdown) return trace.wrapSpanContext(INVALID_SPAN_CONTEXT)
    const parent = options.root === true ? undefined : trace.getSpanContext(context)
    const hasParent = parent !== undefined && isSpanContextValid(parent)
    // AlwaysOn: every span is sampled, whatever flags the parent carries (D-H).
    const spanContext: SpanContext = {
      traceId: hasParent ? parent.traceId : randomHexId(16),
      spanId: randomHexId(8),
      traceFlags: TraceFlags.SAMPLED,
    }
    return new MinimalSpan({
      processor: this.#provider.processor,
      clock: this.#provider.clock,
      name,
      spanContext,
      parentSpanId: hasParent ? parent.spanId : undefined,
      kind: options.kind ?? SpanKind.INTERNAL,
      start: toUnixNanos(options.startTime, this.#provider.clock),
      attributes: options.attributes,
    })
  }

  startActiveSpan<F extends (span: Span) => unknown>(name: string, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(name: string, options: SpanOptions, fn: F): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    options: SpanOptions,
    context: Context,
    fn: F,
  ): ReturnType<F>
  startActiveSpan<F extends (span: Span) => unknown>(
    name: string,
    second: SpanOptions | F,
    third?: Context | F,
    fourth?: F,
  ): ReturnType<F> {
    const fn = (fourth ?? (typeof third === "function" ? third : second)) as F
    const options = typeof second === "function" ? {} : second
    const parent = typeof third === "object" ? third : apiContext.active()
    const span = this.startSpan(name, options, parent)
    return apiContext.with(trace.setSpan(parent, span), () => fn(span)) as ReturnType<F>
  }
}

export class MinimalTracerProvider implements TracerProvider {
  readonly processor: SpanProcessor
  readonly clock: OtelClock
  readonly #tracer: MinimalTracer
  isShutdown = false

  constructor(input: { readonly processor: SpanProcessor; readonly clock?: OtelClock }) {
    this.processor = input.processor
    this.clock = input.clock ?? systemClock
    this.#tracer = new MinimalTracer(this)
  }

  /** One instrumentation scope per process (the spool header carries it), so every name gets the same tracer. */
  getTracer(_name: string, _version?: string): Tracer {
    return this.#tracer
  }

  shutdown(): void {
    if (this.isShutdown) return
    this.isShutdown = true
    this.processor.shutdown()
  }
}
