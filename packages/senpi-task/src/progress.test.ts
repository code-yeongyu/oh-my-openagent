import { describe, expect, test } from "bun:test"

import { createChildProgress, readToolProgressDetails } from "./progress"

const RESOLVED_MODEL = {
  provider: "kimi-coding",
  model_id: "kimi-k3-unlocked",
  display: "Kimi K3 Unlocked",
  reasoning_effort: "max",
  source: "category",
} as const

describe("child task progress", () => {
  test("#given a task summary #when progress is composed #then the activity identity is the summary", () => {
    // given
    const progress = createChildProgress(
      "st_00000001",
      { category: "quick", taskSummary: "Audit the boundary", description: "quick label" },
      1_000,
      () => 1_000,
    )

    // then
    expect(progress.details().progress.activity.startsWith("Audit the boundary")).toBe(true)
  })

  test("#given child events #when progress is composed #then activity carries target, model, turn and tool counts", () => {
    // given
    let nowMs = 1_000
    const progress = createChildProgress(
      "st_00000001",
      { category: "quick", resolvedModel: RESOLVED_MODEL },
      1_000,
      () => nowMs,
    )

    // when
    progress.accept({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    nowMs = 3_000
    progress.accept({ type: "tool_execution_end", toolName: "read" })
    nowMs = 5_000
    progress.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "First line\nFinal assistant update" }],
        usage: { output: 100, totalTokens: 500 },
      },
    })

    // then
    const details = progress.details()
    expect(details).toEqual({
      progress: {
        activity: "st_00000001 · category:quick(kimi-coding/kimi-k3-unlocked:max) · turn 1 (1 tool) · running · 50 tok/s",
        startedAt: 1_000,
      },
      childId: "st_00000001",
      lastAssistantLine: "Final assistant update",
      turns: 1,
      toolCalls: 1,
      tokens: 500,
      outputTokens: 100,
      tokensPerSecond: 50,
    })
    expect(progress.contentText()).toBe("↳ last: Final assistant update")
  })

  test("#given a human description #when progress is composed #then the activity leads with what the task is, not its id", () => {
    // given
    const progress = createChildProgress(
      "st_00000009",
      { category: "quick", description: "Audit the waiting line", name: "task-1", resolvedModel: RESOLVED_MODEL },
      1_000,
      () => 2_000,
    )

    // then the id survives only as the correlation handle inside details, not as the lead token
    expect(progress.details().progress.activity).toBe(
      "Audit the waiting line · category:quick(kimi-coding/kimi-k3-unlocked:max) · starting",
    )
    expect(progress.details().childId).toBe("st_00000009")
  })

  test("#given a running tool #when composed #then the activity names the tool and pluralizes tool counts", () => {
    // given
    const progress = createChildProgress("st_00000002", { agentType: "plan-reviewer" }, 1_000, () => 2_000)

    // when
    progress.accept({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } })
    progress.accept({ type: "tool_execution_end", toolName: "read" })
    progress.accept({ type: "tool_execution_start", toolName: "grep", args: { pattern: "TODO" } })
    progress.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "looking" }] },
    })

    // then
    const details = progress.details()
    expect(details.progress.activity).toBe("st_00000002 · agent:plan-reviewer · turn 1 (2 tools) · running grep TODO")
    expect(details.currentTool).toBe("grep TODO")
    expect(details.toolCalls).toBe(2)
  })

  test("#given runtime fallback events #when progress is composed #then the active model and fallback count update", () => {
    // given
    const progress = createChildProgress(
      "st_00000004",
      { category: "quick", resolvedModel: RESOLVED_MODEL },
      1_000,
      () => 2_000,
    )

    // when
    progress.accept({ type: "retry_fallback_applied", to: "chatgpt-subscription/gpt-5.6-luna-fast:high" })
    progress.accept({ type: "retry_fallback_applied", to: "anthropic-api/claude-haiku-4-5:medium" })

    // then
    expect(progress.details().progress.activity).toBe(
      "st_00000004 · category:quick(anthropic-api/claude-haiku-4-5:medium) · fallback:2 · starting",
    )
  })

  test("#given no events yet #when composed #then activity has no turn-zero noise beyond the base status", () => {
    // given
    const progress = createChildProgress("st_00000003", { category: "deep" }, 1_000, () => 1_000)

    // then
    expect(progress.details().progress.activity).toBe("st_00000003 · category:deep · starting")
    expect(progress.contentText()).toBe("")
  })

  test("#given unknown details #when read #then only the local progress shape is accepted", () => {
    expect(
      readToolProgressDetails({ progress: { activity: "queued", startedAt: 1 }, childId: "st_1", turns: 0 }),
    ).toEqual({
      progress: { activity: "queued", startedAt: 1 },
      childId: "st_1",
      turns: 0,
    })
    expect(
      readToolProgressDetails({
        progress: { activity: "running", startedAt: 1 },
        childId: "st_1",
        turns: 1,
        toolCalls: 2,
        outputTokens: 10,
        tokensPerSecond: 5,
      }),
    ).toEqual({
      progress: { activity: "running", startedAt: 1 },
      childId: "st_1",
      turns: 1,
      toolCalls: 2,
      outputTokens: 10,
      tokensPerSecond: 5,
    })
    expect(readToolProgressDetails({ progress: { startedAt: "1" }, childId: "st_1", turns: 0 })).toBeUndefined()
    expect(
      readToolProgressDetails({ progress: { activity: "x", startedAt: 1 }, childId: "st_1", turns: 0, toolCalls: "2" }),
    ).toBeUndefined()
  })
})

describe("child task progress before the first successful turn", () => {
  test("#given no events #when progress is composed #then the row reads starting with no turn token", () => {
    // given
    const progress = createChildProgress("st_00000005", { category: "deep-low" }, 1_000, () => 2_000)

    // when / then
    const details = progress.details()
    expect(details.progress.activity).toBe("st_00000005 · category:deep-low · starting")
    expect(details.turns).toBe(0)
    expect(details.failedTurns).toBeUndefined()
  })

  test("#given failed assistant turns #when progress is composed #then the row counts failures and reads retrying", () => {
    // given
    let nowMs = 1_000
    const progress = createChildProgress("st_00000006", { category: "deep-low" }, 1_000, () => nowMs)

    // when — provider errors end two assistant turns without usable output
    nowMs = 9_000
    progress.accept({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } })
    nowMs = 21_000
    progress.accept({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "" }], stopReason: "aborted" },
    })

    // then
    const details = progress.details()
    expect(details.progress.activity).toBe("st_00000006 · category:deep-low · failed 2 · retrying")
    expect(details.turns).toBe(0)
    expect(details.failedTurns).toBe(2)
  })

  test("#given a failed turn followed by a successful one #when progress is composed #then both counters ride the row and the verb recovers to running", () => {
    // given
    let nowMs = 1_000
    const progress = createChildProgress("st_00000007", { category: "quick" }, 1_000, () => nowMs)

    // when
    nowMs = 4_000
    progress.accept({ type: "message_end", message: { role: "assistant", content: [], stopReason: "error" } })
    nowMs = 12_000
    progress.accept({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "recovered" }],
        usage: { output: 40, totalTokens: 100 },
      },
    })

    // then — the failure re-anchored the generation window, so tps is measured from it
    const details = progress.details()
    expect(details.progress.activity).toBe("st_00000007 · category:quick · turn 1 · failed 1 · running · 5 tok/s")
    expect(details.turns).toBe(1)
    expect(details.failedTurns).toBe(1)
  })

  test("#given a tool in flight #when progress is composed #then the tool leads the verb even before any turn", () => {
    // given
    const progress = createChildProgress("st_00000008", { category: "quick" }, 1_000, () => 2_000)

    // when
    progress.accept({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } })

    // then — tool calls are real progress, so the turn token renders with zero turns
    expect(progress.details().progress.activity).toBe("st_00000008 · category:quick · turn 0 (1 tool) · running read a.ts")
  })

  test("#given details carrying failed turns #when read #then the field survives the round trip and stays optional", () => {
    // given / when / then
    expect(
      readToolProgressDetails({
        progress: { activity: "starting", startedAt: 1 },
        childId: "st_1",
        turns: 0,
        failedTurns: 2,
      }),
    ).toEqual({
      progress: { activity: "starting", startedAt: 1 },
      childId: "st_1",
      turns: 0,
      failedTurns: 2,
    })
    expect(
      readToolProgressDetails({ progress: { activity: "starting", startedAt: 1 }, childId: "st_1", turns: 0, failedTurns: "2" }),
    ).toBeUndefined()
  })
})
