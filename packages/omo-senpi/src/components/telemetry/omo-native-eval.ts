export const SENPI_EVAL_EXECUTION_EVENT = "senpi.eval.execution"

export type EvalExecutionRollup = {
  readonly eventCount: number
  readonly rejectedCount: number
  readonly okCount: number
  readonly detachedCount: number
  readonly measuredExecutionDurationMsSum: number
  readonly nestedToolCallCount: number
  readonly nestedToolCallOkCount: number
  readonly nestedToolCallErrorCount: number
  readonly nestedToolCallPendingCount: number
  readonly measuredNestedToolDurationMsSum: number
  readonly truncatedExecutionCount: number
}

export const EMPTY_EVAL_EXECUTION_ROLLUP: EvalExecutionRollup = Object.freeze({
  eventCount: 0,
  rejectedCount: 0,
  okCount: 0,
  detachedCount: 0,
  measuredExecutionDurationMsSum: 0,
  nestedToolCallCount: 0,
  nestedToolCallOkCount: 0,
  nestedToolCallErrorCount: 0,
  nestedToolCallPendingCount: 0,
  measuredNestedToolDurationMsSum: 0,
  truncatedExecutionCount: 0,
})

export const REJECTED_EVAL_EXECUTION_ROLLUP: EvalExecutionRollup = Object.freeze({
  ...EMPTY_EVAL_EXECUTION_ROLLUP,
  rejectedCount: 1,
})

export type EvalExecutionParseResult =
  | {
    readonly kind: "accepted"
    readonly cellId: string
    readonly rollup: EvalExecutionRollup
  }
  | {
    readonly kind: "rejected"
    readonly cellId: string
  }
  | {
    readonly kind: "ignored"
  }

type ToolAggregate = {
  readonly count: number
  readonly totalDurationMs: number
  readonly okCount: number
  readonly errorCount: number
  readonly pendingCount: number
}

type AggregateTotals = ToolAggregate

const EMPTY_AGGREGATE: AggregateTotals = Object.freeze({
  count: 0,
  totalDurationMs: 0,
  okCount: 0,
  errorCount: 0,
  pendingCount: 0,
})

export function parseEvalExecutionEvent(value: unknown): EvalExecutionParseResult {
  if (!isRecord(value)) return { kind: "ignored" }
  const cellId = value["cellId"]
  if (typeof cellId !== "string" || cellId.length === 0) return { kind: "ignored" }

  const toolCallCount = safeCount(value["toolCallCount"])
  const pendingToolCallCount = safeCount(value["pendingToolCallCount"])
  const durationMs = finiteNonnegative(value["durationMs"])
  const kernelDurationMs = value["kernelDurationMs"]
  if (
    value["version"] !== 1
    || value["detailLevel"] !== "full"
    || !isEvalLanguage(value["language"])
    || typeof value["ok"] !== "boolean"
    || typeof value["detached"] !== "boolean"
    || !finiteNumber(value["startedAt"])
    || !finiteNumber(value["completedAt"])
    || durationMs === undefined
    || (kernelDurationMs !== undefined && finiteNonnegative(kernelDurationMs) === undefined)
    || toolCallCount === undefined
    || pendingToolCallCount === undefined
    || !Array.isArray(value["toolCalls"])
    || !stringArray(value["distinctToolsCalled"])
    || typeof value["toolAggregatesTruncated"] !== "boolean"
  ) {
    return { kind: "rejected", cellId }
  }

  const named = parseAggregateRecord(value["toolAggregates"])
  if (named === undefined) return { kind: "rejected", cellId }
  const overflowValue = value["toolAggregateOverflow"]
  const truncated = value["toolAggregatesTruncated"]
  const overflow = overflowValue === undefined ? undefined : parseToolAggregate(overflowValue)
  if (
    (truncated && overflow === undefined)
    || (!truncated && overflowValue !== undefined)
  ) {
    return { kind: "rejected", cellId }
  }

  const totals = overflow === undefined ? named : addAggregate(named, overflow)
  if (
    totals.count !== toolCallCount
    || totals.pendingCount !== pendingToolCallCount
  ) {
    return { kind: "rejected", cellId }
  }

  return {
    kind: "accepted",
    cellId,
    rollup: {
      eventCount: 1,
      rejectedCount: 0,
      okCount: value["ok"] ? 1 : 0,
      detachedCount: value["detached"] ? 1 : 0,
      measuredExecutionDurationMsSum: durationMs,
      nestedToolCallCount: toolCallCount,
      nestedToolCallOkCount: totals.okCount,
      nestedToolCallErrorCount: totals.errorCount,
      nestedToolCallPendingCount: totals.pendingCount,
      measuredNestedToolDurationMsSum: totals.totalDurationMs,
      truncatedExecutionCount: truncated ? 1 : 0,
    },
  }
}

export function addEvalExecutionRollup(
  left: EvalExecutionRollup,
  right: EvalExecutionRollup,
): EvalExecutionRollup {
  return {
    eventCount: left.eventCount + right.eventCount,
    rejectedCount: left.rejectedCount + right.rejectedCount,
    okCount: left.okCount + right.okCount,
    detachedCount: left.detachedCount + right.detachedCount,
    measuredExecutionDurationMsSum:
      left.measuredExecutionDurationMsSum + right.measuredExecutionDurationMsSum,
    nestedToolCallCount: left.nestedToolCallCount + right.nestedToolCallCount,
    nestedToolCallOkCount: left.nestedToolCallOkCount + right.nestedToolCallOkCount,
    nestedToolCallErrorCount:
      left.nestedToolCallErrorCount + right.nestedToolCallErrorCount,
    nestedToolCallPendingCount:
      left.nestedToolCallPendingCount + right.nestedToolCallPendingCount,
    measuredNestedToolDurationMsSum:
      left.measuredNestedToolDurationMsSum + right.measuredNestedToolDurationMsSum,
    truncatedExecutionCount:
      left.truncatedExecutionCount + right.truncatedExecutionCount,
  }
}

function parseAggregateRecord(value: unknown): AggregateTotals | undefined {
  if (!isRecord(value)) return undefined
  let totals = EMPTY_AGGREGATE
  for (const aggregateValue of Object.values(value)) {
    const aggregate = parseToolAggregate(aggregateValue)
    if (aggregate === undefined) return undefined
    totals = addAggregate(totals, aggregate)
  }
  return totals
}

function parseToolAggregate(value: unknown): ToolAggregate | undefined {
  if (!isRecord(value)) return undefined
  const count = safeCount(value["count"])
  const totalDurationMs = finiteNonnegative(value["totalDurationMs"])
  const okCount = safeCount(value["okCount"])
  const errorCount = safeCount(value["errorCount"])
  const pendingCount = safeCount(value["pendingCount"])
  if (
    count === undefined
    || totalDurationMs === undefined
    || okCount === undefined
    || errorCount === undefined
    || pendingCount === undefined
    || count !== okCount + errorCount + pendingCount
  ) {
    return undefined
  }
  return { count, totalDurationMs, okCount, errorCount, pendingCount }
}

function addAggregate(left: AggregateTotals, right: ToolAggregate): AggregateTotals {
  return {
    count: left.count + right.count,
    totalDurationMs: left.totalDurationMs + right.totalDurationMs,
    okCount: left.okCount + right.okCount,
    errorCount: left.errorCount + right.errorCount,
    pendingCount: left.pendingCount + right.pendingCount,
  }
}

function safeCount(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function finiteNonnegative(value: unknown): number | undefined {
  return finiteNumber(value) && value >= 0 ? value : undefined
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}

function isEvalLanguage(value: unknown): boolean {
  return value === "js" || value === "py" || value === "rb" || value === "jl"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
