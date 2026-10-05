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

  test("#given a context exposing the effective tier #when captured #then the parent tier is the effective one", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when
    runtime.captureFrom({ serviceTier: undefined, effectiveServiceTier: "priority" })

    // then
    expect(runtime.parentServiceTier()).toBe("priority")
  })

  test("#given an engine exposing only serviceTier #when captured #then that tier is used and later contexts replace it", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when
    runtime.captureFrom({ serviceTier: "priority" })
    const first = runtime.parentServiceTier()
    runtime.captureFrom({ serviceTier: undefined, effectiveServiceTier: undefined })

    // then
    expect(first).toBe("priority")
    expect(runtime.parentServiceTier()).toBeUndefined()
  })

  test("#given a context without tier fields or with a malformed tier #when captured #then no parent tier is recorded", () => {
    // given
    const runtime = new TaskRuntimeContext("/project")

    // when
    runtime.captureFrom({ cwd: "/elsewhere" })
    const untouched = runtime.parentServiceTier()
    runtime.captureFrom({ effectiveServiceTier: "turbo" })

    // then
    expect(untouched).toBeUndefined()
    expect(runtime.parentServiceTier()).toBeUndefined()
  })
})
