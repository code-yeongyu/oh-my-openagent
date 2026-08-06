import { describe, expect, test } from "bun:test"

import { createRunStatsTracker } from "./run-stats"

const EVAL_RESULT_WITH_TWO_TOOLS = {
  content: [{ type: "text", text: "done" }],
  details: {
    language: "py",
    durationMs: 10,
    toolCalls: [
      { name: "read", ok: true },
      { name: "bash", ok: true },
    ],
    truncated: false,
  },
}

describe("eval nested tool accounting", () => {
  test("#given one eval with two nested calls #when the eval ends #then outer and nested calls total three", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-1",
      toolName: "eval",
      args: { action: "run", language: "py", code: "read(); bash()" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "eval-1",
      toolName: "eval",
      result: EVAL_RESULT_WITH_TWO_TOOLS,
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(3)
  })

  test("#given an eval without nested calls #when it ends #then the eval still counts once", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-empty",
      toolName: "eval",
      args: { language: "py", code: "print('done')" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "eval-empty",
      toolName: "eval",
      result: { content: [], details: { toolCalls: [] } },
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(1)
  })

  test("#given an eval control call #when its result repeats prior nested calls #then only the control call is new", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-peek",
      toolName: "eval",
      args: { action: "peek", cell_id: "cell-1" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "eval-peek",
      toolName: "eval",
      result: EVAL_RESULT_WITH_TWO_TOOLS,
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(1)
  })

  test("#given an input-only eval control call #when its result repeats prior nested calls #then only the control call is new", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-input-peek",
      toolName: "eval",
      input: { action: "peek", cell_id: "cell-1" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "eval-input-peek",
      toolName: "eval",
      result: EVAL_RESULT_WITH_TWO_TOOLS,
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(1)
  })

  test("#given malformed eval tool summaries #when the eval ends #then only valid tool calls are counted", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-malformed",
      toolName: "eval",
      args: { language: "py", code: "read(); bash()" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "eval-malformed",
      toolName: "eval",
      result: {
        content: [],
        details: {
          toolCalls: [
            { name: "read", ok: true },
            null,
            { name: "bash" },
            { name: "", ok: true },
            { name: "bash", ok: false },
          ],
        },
      },
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(3)
  })

  test("#given a non-eval tool result with details #when it ends #then the top-level tool counts once", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)

    // when
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "read-1",
      toolName: "read",
      args: { path: "src/foo.ts" },
    })
    tracker.accept({
      type: "tool_execution_end",
      toolCallId: "read-1",
      toolName: "read",
      result: EVAL_RESULT_WITH_TWO_TOOLS,
      isError: false,
    })

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(1)
  })

  test("#given a duplicated eval end #when both arrive #then nested calls are counted only once", () => {
    // given
    const tracker = createRunStatsTracker(1_000, () => 2_000)
    const endEvent = {
      type: "tool_execution_end",
      toolCallId: "eval-duplicate",
      toolName: "eval",
      result: EVAL_RESULT_WITH_TWO_TOOLS,
      isError: false,
    } as const
    tracker.accept({
      type: "tool_execution_start",
      toolCallId: "eval-duplicate",
      toolName: "eval",
      args: { language: "py", code: "read(); bash()" },
    })

    // when
    tracker.accept(endEvent)
    tracker.accept(endEvent)

    // then
    expect(tracker.snapshot(2_000).tool_calls).toBe(3)
  })
})
