import { describe, expect, test } from "bun:test"

import { toV1Event } from "./event-shape"

describe("OpenCode V2 event shape", () => {
  test("maps session.retry.scheduled into the V1 retry-status shape", () => {
    expect(toV1Event({
      type: "session.retry.scheduled",
      data: {
        sessionID: "ses_retry",
        assistantMessageID: "msg_assistant",
        attempt: 2,
        at: 123,
        error: { type: "ProviderError", message: "overloaded", status: 503 },
      },
    })).toEqual({
      type: "session.status",
      properties: {
        sessionID: "ses_retry",
        status: { type: "retry", message: "overloaded", attempt: 2 },
        error: { type: "ProviderError", message: "overloaded", status: 503 },
      },
    })
  })

  test("passes session.compaction.failed through as a terminal event", () => {
    expect(toV1Event({
      type: "session.compaction.failed",
      data: { sessionID: "ses_compact", error: { message: "provider failed" } },
    })).toEqual({
      type: "session.compaction.failed",
      properties: { sessionID: "ses_compact", error: { message: "provider failed" } },
    })
  })
})
