import { describe, expect, test } from "bun:test"

import { createTaskRecord } from "../state"
import { buildCompletionDetails, buildCompletionMessage } from "./notification"

describe("task completion model visibility", () => {
  test("#given a resolved category model #when completion is rendered #then the event names both", () => {
    // given
    const record = createTaskRecord({
      parent_session_id: "parent-session",
      root_session_id: "parent-session",
      depth: 1,
      execution_mode: "in-process",
      category: "quick",
      model: "requested/model",
      resolved_model: {
        source: "category",
        provider: "quotio-openai",
        model_id: "gpt-5.4-mini-fast",
        display: "quotio-openai/gpt-5.4-mini-fast",
      },
    })
    const completed = {
      ...record,
      status: "completed" as const,
      final_response: "done",
    }

    // when
    const message = buildCompletionMessage([buildCompletionDetails(completed)])

    // then
    expect(message.content).toContain("category:quick")
    expect(message.content).toContain("model:quotio-openai/gpt-5.4-mini-fast")
    expect(message.content).not.toContain("model:requested/model")
  })
})
