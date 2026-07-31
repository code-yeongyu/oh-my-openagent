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
      "Audit the waiting line · category:quick(kimi-coding/kimi-k3-unlocked:max) · turn 0 · running",
    )
    expect(progress.details().childId).toBe("st_00000009")
  })

  test("#given a running tool #when composed #then the activity names the tool and pluralizes tool counts", () => {
    // given
    const progress = createChildProgress("st_00000002", { agentType: "momus" }, 1_000, () => 2_000)

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
    expect(details.progress.activity).toBe("st_00000002 · momus · turn 1 (2 tools) · running grep TODO")
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
    progress.accept({ type: "retry_fallback_applied", to: "quotio-openai/gpt-5.4-mini-fast:high" })
    progress.accept({ type: "retry_fallback_applied", to: "anthropic-api/claude-haiku-4-5:medium" })

    // then
    expect(progress.details().progress.activity).toBe(
      "st_00000004 · category:quick(anthropic-api/claude-haiku-4-5:medium) · fallback:2 · turn 0 · running",
    )
  })

  test("#given no events yet #when composed #then activity has no turn-zero noise beyond the base status", () => {
    // given
    const progress = createChildProgress("st_00000003", { category: "deep" }, 1_000, () => 1_000)

    // then
    expect(progress.details().progress.activity).toBe("st_00000003 · category:deep · turn 0 · running")
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
