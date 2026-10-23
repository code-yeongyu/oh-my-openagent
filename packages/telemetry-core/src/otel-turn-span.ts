import {
  context,
  defaultTextMapGetter,
  defaultTextMapSetter,
  SpanKind,
  SpanStatusCode,
  trace,
  type Context,
  type Tracer,
} from "@opentelemetry/api"
import { W3CTraceContextPropagator } from "@opentelemetry/core"

import { isTraceparent } from "./turn-trace-bridge"
import type { TurnSpanHandle, TurnSpanStart, TurnTracing } from "./types"

export const TURN_SPAN_NAME = "omo.turn"

const w3c = new W3CTraceContextPropagator()

/**
 * The parent of a turn: a valid inherited `traceparent` (the task bridge), else whatever context is
 * active. Sampling is not consulted: the tracer is AlwaysOn, so an inherited `-00` still records.
 */
function parentContext(parentTraceparent: string | undefined): Context {
  const active = context.active()
  if (!isTraceparent(parentTraceparent)) return active
  return w3c.extract(active, { traceparent: parentTraceparent }, defaultTextMapGetter)
}

export function createTurnTracing(input: { readonly tracer: Tracer; readonly isEnabled: () => boolean }): TurnTracing {
  return {
    startTurn(start: TurnSpanStart): TurnSpanHandle | undefined {
      if (!input.isEnabled()) return undefined
      const span = input.tracer.startSpan(
        TURN_SPAN_NAME,
        { kind: SpanKind.INTERNAL, attributes: start.attributes },
        parentContext(start.parentTraceparent),
      )
      const spanContext = span.spanContext()
      if (!trace.isSpanContextValid(spanContext)) return undefined
      const carrier: Record<string, string> = {}
      w3c.inject(trace.setSpan(context.active(), span), carrier, defaultTextMapSetter)
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
        traceparent: carrier["traceparent"] ?? "",
        run: (fn) => context.with(trace.setSpan(context.active(), span), fn),
        setAttributes: (attributes) => {
          span.setAttributes(attributes)
        },
        end: (status) => {
          if (!span.isRecording()) return
          span.setStatus({ code: status === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR })
          span.end()
        },
      }
    },
  }
}
