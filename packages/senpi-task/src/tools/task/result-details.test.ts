import { expect, test } from "bun:test"

import { createTaskRecord } from "../../state"
import { recordDetails } from "./result-details"

test("#given a record with fallback attempts #when result details are built #then the renderer receives the recorded history", () => {
  // given
  const fallbackAttempts = [
    { provider: "kimi-coding", model_id: "kimi-for-coding-highspeed", display: "kimi-for-coding-highspeed", source: "category" as const },
    {
      provider: "quotio-openai",
      model_id: "gpt-5.4-mini-fast",
      display: "gpt-5.4-mini-fast",
      reasoning_effort: "high",
      source: "category" as const,
    },
  ]
  const record = createTaskRecord({
    parent_session_id: "session-parent",
    root_session_id: "session-root",
    depth: 0,
    execution_mode: "in-process",
    model: "quotio-openai/gpt-5.4-mini-fast",
    fallback_attempts: fallbackAttempts,
  }, 1)

  // when
  const details = recordDetails(record, "spawn")

  // then
  expect(details.fallback_attempts).toEqual(fallbackAttempts)
})
