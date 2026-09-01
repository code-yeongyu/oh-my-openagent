import { describe, expect, test } from "bun:test"

import { TaskRuntimeContext } from "./runtime-context"

describe("TaskRuntimeContext session facts", () => {
  test("#given a live session manager with its file #when captured #then the exact file path is retained", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when
    runtime.captureFrom({
      sessionManager: {
        getSessionId: () => "session-a",
        getSessionFile: () => "/tmp/senpi/sessions/session-a.jsonl",
      },
    })

    // then
    expect(runtime.sessionId()).toBe("session-a")
    expect(runtime.sessionFile()).toBe("/tmp/senpi/sessions/session-a.jsonl")
  })
})
