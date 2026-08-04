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
      notify_on_terminal: false,
      resolved_model: {
        source: "category",
        provider: "quotio-openai",
        model_id: "gpt-5.6-luna-fast",
        display: "quotio-openai/gpt-5.6-luna-fast",
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
    expect(message.content).toContain("category:quick(quotio-openai/gpt-5.6-luna-fast)")
    expect(message.content).not.toContain("requested/model")
  })
})
