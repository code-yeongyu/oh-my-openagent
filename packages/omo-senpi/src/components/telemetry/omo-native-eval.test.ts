import { describe, expect, test } from "bun:test"

import {
  EMPTY_EVAL_EXECUTION_ROLLUP,
  addEvalExecutionRollup,
  parseEvalExecutionEvent,
} from "./omo-native-eval"

type Aggregate = {
  readonly count: number
  readonly totalDurationMs: number
  readonly okCount: number
  readonly errorCount: number
  readonly pendingCount: number
}

function aggregate(
  count: number,
  options: Partial<Omit<Aggregate, "count">> = {},
): Aggregate {
  return {
    count,
    totalDurationMs: options.totalDurationMs ?? count * 10,
    okCount: options.okCount ?? count,
    errorCount: options.errorCount ?? 0,
    pendingCount: options.pendingCount ?? 0,
  }
}

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    detailLevel: "full",
    cellId: "eval-1",
    language: "js",
    ok: true,
    startedAt: 1_000,
    completedAt: 1_030,
    durationMs: 30,
    kernelDurationMs: 24,
    detached: false,
    toolCallCount: 2,
    pendingToolCallCount: 0,
    toolCalls: [],
    distinctToolsCalled: ["read", "bash"],
    toolAggregates: {
      read: aggregate(1, { totalDurationMs: 12 }),
      bash: aggregate(1, { totalDurationMs: 18 }),
    },
    toolAggregatesTruncated: false,
    ...overrides,
  }
}

describe("omo-native eval execution event parser", () => {
  test("#given one valid full v1 event #when parsed #then only fixed scalar rollups remain", () => {
    // given
    const input = payload({
      toolCalls: [{ name: "read", args: { path: "/secret" }, resultPreview: "private" }],
    })
    // when
    const parsed = parseEvalExecutionEvent(input)
    // then
    expect(parsed).toEqual({
      kind: "accepted",
      cellId: "eval-1",
      rollup: {
        eventCount: 1,
        rejectedCount: 0,
        okCount: 1,
        detachedCount: 0,
        measuredExecutionDurationMsSum: 30,
        nestedToolCallCount: 2,
        nestedToolCallOkCount: 2,
        nestedToolCallErrorCount: 0,
        nestedToolCallPendingCount: 0,
        measuredNestedToolDurationMsSum: 30,
        truncatedExecutionCount: 0,
      },
    })
    expect(JSON.stringify(parsed)).not.toContain("/secret")
    expect(JSON.stringify(parsed)).not.toContain("private")
    expect(JSON.stringify(parsed)).not.toContain("read")
    expect(JSON.stringify(parsed)).not.toContain("bash")
  })

  test("#given forty calls but thirty enriched details #when parsed #then toolCallCount stays authoritative", () => {
    // given
    const input = payload({
      toolCallCount: 40,
      toolCalls: Array.from({ length: 30 }, (_, index) => ({ name: "read", callId: `call-${index}` })),
      distinctToolsCalled: ["read"],
      toolAggregates: { read: aggregate(40, { totalDurationMs: 400 }) },
    })
    // when
    const parsed = parseEvalExecutionEvent(input)
    // then
    expect(parsed.kind === "accepted" ? parsed.rollup.nestedToolCallCount : undefined).toBe(40)
    expect(parsed.kind === "accepted" ? parsed.rollup.measuredNestedToolDurationMsSum : undefined).toBe(400)
  })

  test("#given aggregate overflow #when parsed #then named and overflow totals close exactly", () => {
    // given
    const input = payload({
      toolCallCount: 3,
      pendingToolCallCount: 1,
      toolAggregates: { read: aggregate(2, { totalDurationMs: 20, okCount: 1, errorCount: 1 }) },
      toolAggregatesTruncated: true,
      toolAggregateOverflow: aggregate(1, {
        totalDurationMs: 15,
        okCount: 0,
        errorCount: 0,
        pendingCount: 1,
      }),
    })
    // when
    const parsed = parseEvalExecutionEvent(input)
    // then
    expect(parsed).toEqual({
      kind: "accepted",
      cellId: "eval-1",
      rollup: {
        eventCount: 1,
        rejectedCount: 0,
        okCount: 1,
        detachedCount: 0,
        measuredExecutionDurationMsSum: 30,
        nestedToolCallCount: 3,
        nestedToolCallOkCount: 1,
        nestedToolCallErrorCount: 1,
        nestedToolCallPendingCount: 1,
        measuredNestedToolDurationMsSum: 35,
        truncatedExecutionCount: 1,
      },
    })
  })

  test("#given malformed correlated payloads #when parsed #then they reject without partial totals", () => {
    // given
    const malformed = [
      payload({ version: 2 }),
      payload({ detailLevel: "metadata" }),
      payload({ durationMs: -1 }),
      payload({ toolCallCount: 1.5 }),
      payload({ toolAggregates: { read: aggregate(1), bash: aggregate(1) }, toolCallCount: 1 }),
      payload({ toolAggregates: { read: aggregate(1, { pendingCount: 1 }) }, pendingToolCallCount: 0 }),
      payload({ toolAggregatesTruncated: true }),
      payload({ toolAggregatesTruncated: false, toolAggregateOverflow: aggregate(1) }),
    ]
    // when
    const parsed = malformed.map(parseEvalExecutionEvent)
    // then
    expect(parsed).toEqual(malformed.map(() => ({ kind: "rejected", cellId: "eval-1" })))
  })

  test("#given values without a usable cell id #when parsed #then they are ignored", () => {
    expect([null, "event", 1, [], {}, payload({ cellId: "" }), payload({ cellId: 42 })].map(parseEvalExecutionEvent))
      .toEqual(Array.from({ length: 7 }, () => ({ kind: "ignored" })))
  })

  test("#given two accepted events #when rollups are added #then every scalar is summed", () => {
    // given
    const first = parseEvalExecutionEvent(payload())
    const second = parseEvalExecutionEvent(payload({
      cellId: "eval-2",
      ok: false,
      detached: true,
      toolCallCount: 1,
      toolAggregates: { bash: aggregate(1, { totalDurationMs: 7, okCount: 0, errorCount: 1 }) },
    }))
    expect(first.kind).toBe("accepted")
    expect(second.kind).toBe("accepted")
    if (first.kind !== "accepted" || second.kind !== "accepted") return
    // when
    const combined = addEvalExecutionRollup(addEvalExecutionRollup(EMPTY_EVAL_EXECUTION_ROLLUP, first.rollup), second.rollup)
    // then
    expect(combined).toMatchObject({
      eventCount: 2,
      okCount: 1,
      detachedCount: 1,
      nestedToolCallCount: 3,
      nestedToolCallOkCount: 2,
      nestedToolCallErrorCount: 1,
      measuredNestedToolDurationMsSum: 37,
    })
  })
})
