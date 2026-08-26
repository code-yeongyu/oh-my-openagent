import { describe, expect, test } from "bun:test"

import { buildCompletionDetails, buildCompletionMessage } from "./completion"

function completedFallbackRecord() {
  return {
    task_id: "st_fallback",
    name: "fallback-worker",
    parent_session_id: "parent-session",
    root_session_id: "root-session",
    depth: 1,
    execution_mode: "in-process",
    model: "vendor-b/fallback-model",
    notify_on_terminal: false,
    requested_model: {
      source: "category",
      provider: "vendor-a",
      model_id: "primary-model",
      display: "vendor-a/primary-model",
    },
    resolved_model: {
      source: "category",
      provider: "vendor-b",
      model_id: "fallback-model",
      display: "vendor-b/fallback-model",
    },
    fallback_models: [
      {
        source: "category",
        provider: "vendor-c",
        model_id: "final-model",
        display: "vendor-c/final-model",
      },
    ],
    status: "completed",
    residency_state: "resident",
    created_at: "2026-07-28T08:00:00.000Z",
    updated_at: "2026-07-28T08:00:03.000Z",
    final_response: "completed on the fallback model",
    notification: { run_epoch: 0, notified_epoch: -1 },
  } as const
}

describe("task completion fallback reporting", () => {
  test("#given a rerouted task #when terminal completion renders #then it reports model fallback once at terminal completion", () => {
    // given
    const record = completedFallbackRecord()

    // when
    const message = buildCompletionMessage([buildCompletionDetails(record)])

    // then
    expect(message.content).toContain(
      "fallback:vendor-a/primary-model->vendor-b/fallback-model",
    )
    expect(message.content.match(/fallback:/gu)).toHaveLength(1)
    expect(message.content).not.toContain("quota")
    expect(message.content).not.toContain("403")
  })

  test("#given no model reroute #when fallback notification rendering runs #then existing completion output stays unchanged", () => {
    // given
    const record = {
      ...completedFallbackRecord(),
      requested_model: {
        source: "category" as const,
        provider: "vendor-a",
        model_id: "primary-model",
        display: "vendor-a/primary-model",
      },
      resolved_model: {
        source: "category" as const,
        provider: "vendor-a",
        model_id: "primary-model",
        display: "vendor-a/primary-model",
      },
      model: "vendor-a/primary-model",
    }

    // when
    const message = buildCompletionMessage([buildCompletionDetails(record)])

    // then
    expect(message.content).toContain("model:vendor-a/primary-model")
    expect(message.content).not.toContain("fallback:")
  })
})
