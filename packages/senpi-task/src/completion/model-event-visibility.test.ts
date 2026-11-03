import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "../state"
import { buildCompletionDetails, buildCompletionMessage } from "./notification"

describe("task completion effective model visibility (F12)", () => {
  test("#given an operator-switched child #when completion is rendered #then the notice names the live model with the operator mark", () => {
    // given
    const record = {
      ...createTaskRecord({
        parent_session_id: "parent-session",
        root_session_id: "parent-session",
        depth: 1,
        execution_mode: "in-process",
        category: "quick",
        model: "kimi-coding/old-model",
        notify_on_terminal: false,
        resolved_model: {
          source: "category",
          provider: "kimi-coding",
          model_id: "old-model",
          display: "kimi-coding/old-model",
        },
      }),
      status: "completed" as const,
      final_response: "done",
      effective_model: { provider: "anthropic", model_id: "claude-opus-5-5", display: "anthropic/claude-opus-5-5", reasoning: "high", source: "set" as const, switched_by_operator: true },
    }

    // when
    const message = buildCompletionMessage([buildCompletionDetails(record)])

    // then
    expect(message.content).toContain("category:quick(anthropic/claude-opus-5-5:high) (switched by operator)")
    expect(message.content).not.toContain("kimi-coding/old-model")
  })

  test("#given a reverted fallback #when completion is rendered #then the notice names the restored model without an operator mark", () => {
    // given
    const record = {
      ...createTaskRecord({
        parent_session_id: "parent-session",
        root_session_id: "parent-session",
        depth: 1,
        execution_mode: "in-process",
        category: "quick",
        model: "chatgpt-subscription/gpt-6-luna-fast",
        notify_on_terminal: false,
        resolved_model: {
          source: "category",
          provider: "kimi-coding",
          model_id: "kimi-for-coding-highspeed-unlocked",
          display: "kimi-coding/kimi-for-coding-highspeed-unlocked",
        },
      }),
      status: "completed" as const,
      final_response: "done",
      effective_model: { provider: "kimi-coding", model_id: "kimi-for-coding-highspeed-unlocked", display: "kimi-coding/kimi-for-coding-highspeed-unlocked", source: "fallback-revert" as const },
    }

    // when
    const message = buildCompletionMessage([buildCompletionDetails(record)])

    // then
    expect(message.content).toContain("category:quick(kimi-coding/kimi-for-coding-highspeed-unlocked)")
    expect(message.content).not.toContain("(switched by operator)")
    expect(message.content).not.toContain("gpt-6-luna-fast")
  })
})
