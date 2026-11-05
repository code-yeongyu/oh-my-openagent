/// <reference types="bun-types" />

// Plan row O4 (comment-checker; Z2.LIFE.O4). omo builds its components once per process, so every session a host
// or hand loads registers the same comment-checker object. The checker's per-turn record of reported files and its
// failed-start flag must belong to each session: session B's turn start leaves session A's record alone, and a
// checker that cannot start in A keeps checking in B.

import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"

import type { CheckResult, RunCommentCheckerInput } from "@oh-my-opencode/comment-checker-core"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createRecordingLogger, createTempCwd, createToolResultEvent } from "./comment-checker.test-support"
import { createCommentCheckerComponent } from "./index"

const violation: CheckResult = { hasComments: true, message: "line 1: redundant comment" }

function sessionContext(cwd: string, sessionId: string): Record<string, unknown> {
  return { cwd, sessionManager: { getSessionId: () => sessionId } }
}

function edit(path: string, toolCallId: string): Record<string, unknown> {
  return createToolResultEvent({ toolCallId, input: { path, edits: [{ oldText: "old", newText: "new" }] } })
}

async function sharedByTwoSessions(results: (input: RunCommentCheckerInput) => CheckResult) {
  const cwd = createTempCwd()
  const checked: Array<{ session: string; path: unknown }> = []
  let current = ""
  const component = createCommentCheckerComponent({
    resolveBinary: () => "/fake/comment-checker",
    downloadBinary: async () => null,
    runCommentChecker: async (input) => {
      checked.push({ session: current, path: input.hookInput.tool_input.file_path })
      return results(input)
    },
  })
  const register = async (sessionId: string) => {
    const pi = new FakeExtensionAPI()
    await component.register(pi, { logger: createRecordingLogger(), config: { getFlag: (name: string) => pi.getFlag(name) } })
    const ctx = sessionContext(cwd, sessionId)
    return {
      dispatch: async (event: string, payload: Record<string, unknown>) => {
        current = sessionId
        return pi.dispatch(event, payload, ctx)
      },
    }
  }
  return { cwd, checked, a: await register("A"), b: await register("B") }
}

describe("comment-checker state per session when sessions share the component (O4)", () => {
  test("#given sessions A and B sharing one checker (MULTI) #when B starts a turn between A's two edits of the same file in one turn #then A's second edit is still skipped", async () => {
    // given
    const s = await sharedByTwoSessions(() => violation)
    await s.a.dispatch("tool_result", edit("src/a.ts", "a1"))

    // when
    await s.b.dispatch("turn_start", { type: "turn_start", turnIndex: 1, timestamp: 1 })
    await s.a.dispatch("tool_result", edit("src/a.ts", "a2"))

    // then
    expect(s.checked).toEqual([{ session: "A", path: resolve(s.cwd, "src/a.ts") }])
  })

  test("#given sessions A and B sharing one checker (MULTI) #when A's checker cannot start #then B still checks its edits", async () => {
    // given
    const s = await sharedByTwoSessions((input) =>
      input.hookInput.session_id === "A" ? { hasComments: false, message: "", failure: { exitCode: 3, stderr: "" } } : violation)
    await s.a.dispatch("tool_result", edit("src/a.ts", "a1"))

    // when
    await s.b.dispatch("tool_result", edit("src/b.ts", "b1"))

    // then
    expect(s.checked).toEqual([
      { session: "A", path: resolve(s.cwd, "src/a.ts") },
      { session: "B", path: resolve(s.cwd, "src/b.ts") },
    ])
  })

  test("#given a session that reported a file #when its session ends and a session with the same id starts #then the file is checked again", async () => {
    // given
    const s = await sharedByTwoSessions(() => violation)
    await s.a.dispatch("tool_result", edit("src/a.ts", "a1"))

    // when
    await s.a.dispatch("session_shutdown", { type: "session_shutdown" })
    await s.a.dispatch("tool_result", edit("src/a.ts", "a2"))

    // then
    expect(s.checked.map((call) => call.session)).toEqual(["A", "A"])
  })
})
