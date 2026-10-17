import { describe, expect, test } from "bun:test"

import { createV1EventShaper, toV1Event } from "./event-shape"

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

  test("maps session.step.started into an assistant message.updated carrying the step model", () => {
    expect(toV1Event({
      type: "session.step.started",
      data: {
        sessionID: "ses_step",
        assistantMessageID: "msg_step",
        agent: "sisyphus",
        model: { id: "deepseek-v4.1-flash", providerID: "opencode-go" },
        started: 123,
      },
    })).toEqual({
      type: "message.updated",
      properties: {
        sessionID: "ses_step",
        info: {
          id: "msg_step",
          sessionID: "ses_step",
          role: "assistant",
          finish: undefined,
          providerID: "opencode-go",
          modelID: "deepseek-v4.1-flash",
          agent: "sisyphus",
        },
      },
    })
  })

  test("joins the started model with the ended usage so providerID and tokens land together", () => {
    const shape = createV1EventShaper()
    shape({
      type: "session.step.started",
      data: {
        sessionID: "ses_join",
        assistantMessageID: "msg_join",
        agent: "sisyphus",
        model: { id: "claude-sonnet-4-6", providerID: "anthropic" },
        started: 1,
      },
    })
    expect(shape({
      type: "session.step.ended",
      data: {
        sessionID: "ses_join",
        assistantMessageID: "msg_join",
        finish: "stop",
        cost: 0.42,
        tokens: { input: 810000, output: 120, reasoning: 0, cache: { read: 10000, write: 0 } },
      },
    })).toEqual({
      type: "message.updated",
      properties: {
        sessionID: "ses_join",
        info: {
          id: "msg_join",
          sessionID: "ses_join",
          role: "assistant",
          finish: "stop",
          providerID: "anthropic",
          modelID: "claude-sonnet-4-6",
          agent: "sisyphus",
          tokens: { input: 810000, output: 120, reasoning: 0, cache: { read: 10000, write: 0 } },
        },
      },
    })
  })

  test("forwards step.ended tokens even without a remembered step.started", () => {
    const event = toV1Event({
      type: "session.step.ended",
      data: {
        sessionID: "ses_solo",
        assistantMessageID: "msg_solo",
        finish: "tool-calls",
        tokens: { input: 5, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    })
    expect(event).toEqual({
      type: "message.updated",
      properties: {
        sessionID: "ses_solo",
        info: {
          id: "msg_solo",
          sessionID: "ses_solo",
          role: "assistant",
          finish: "tool-calls",
          tokens: { input: 5, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      },
    })
    expect("providerID" in (event.properties.info as Record<string, unknown>)).toBe(false)
  })
})
