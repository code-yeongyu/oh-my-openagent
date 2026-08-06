/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { _resetForTesting } from "../../features/claude-code-session-state"
import { handleSessionIdle } from "../../hooks/todo-continuation-enforcer/idle-event"
import { createSessionStateStore } from "../../hooks/todo-continuation-enforcer/session-state"
import { executeSync } from "./sync-executor"

function createDependencies(sessionID: string, isNew: boolean) {
  return {
    createOrGetSession: mock(async () => ({ sessionID, isNew })),
    waitForCompletion: mock(async () => {}),
    processMessages: mock(async () => "agent response"),
    setSessionFallbackChain: mock(() => {}),
    clearSessionFallbackChain: mock(() => {}),
  }
}

function createToolContext() {
  return {
    sessionID: "parent-session",
    messageID: "msg-1",
    agent: "sisyphus",
    abort: new AbortController().signal,
    metadata: mock(async () => {}),
  }
}

function createExecuteContext(abortMock: ReturnType<typeof mock>) {
  const promptAsync = mock(async () => ({ data: {} }))
  return {
    client: {
      session: {
        prompt: promptAsync,
        promptAsync,
        abort: abortMock,
      },
    },
  }
}

function createEnforcerContext() {
  return {
    directory: "/tmp",
    client: {
      session: {
        messages: async () => ({
          data: [
            { info: { role: "user", id: "m1", time: { created: 1 } }, parts: [{ type: "text", text: "implement feature" }] },
            { info: { role: "assistant", id: "m2", time: { created: 2, completed: 3 } }, parts: [{ type: "text", text: "did part of the work" }] },
          ],
        }),
        todo: async () => ({
          data: [
            { id: "t1", content: "step one", status: "completed" },
            { id: "t2", content: "step two", status: "pending" },
          ],
        }),
      },
      tui: { showToast: mock(async () => ({})) },
    },
  }
}

async function driveEnforcerIdle(sessionID: string): Promise<boolean> {
  const store = createSessionStateStore()
  await handleSessionIdle({
    ctx: createEnforcerContext() as never,
    sessionID,
    sessionStateStore: store,
    backgroundManager: { getTasksByParentSession: () => [] } as never,
  })
  const countdownArmed = store.getState(sessionID).countdownStartedAt !== undefined
  store.cancelCountdown(sessionID)
  return countdownArmed
}

const args = {
  subagent_type: "explore",
  description: "test task",
  prompt: "find something",
  run_in_background: false,
}

describe("issue #5112 - completed sync subagent must not be re-awakened", () => {
  afterEach(() => {
    _resetForTesting()
  })

  test("#given a created sync subagent that completed with incomplete todos #when its post-handoff session.idle fires #then todo-continuation does not re-awaken it", async () => {
    //#given
    const childSessionID = "ses-sync-child-created"
    const abortMock = mock(async () => ({ data: true }))
    await executeSync(args, createToolContext(), createExecuteContext(abortMock) as never, createDependencies(childSessionID, true))

    //#when
    const reawakened = await driveEnforcerIdle(childSessionID)

    //#then
    expect(reawakened).toBe(false)
  })

  test("#given a created sync subagent completed #when the handoff finishes #then the child session is aborted (PR #5113)", async () => {
    //#given
    const childSessionID = "ses-sync-child-abort"
    const abortMock = mock(async () => ({ data: true }))

    //#when
    await executeSync(args, createToolContext(), createExecuteContext(abortMock) as never, createDependencies(childSessionID, true))

    //#then
    expect(abortMock).toHaveBeenCalledWith({ path: { id: childSessionID } })
  })

  test("#given the sync run reused an existing session (isNew=false) #when the run finishes #then it is neither aborted nor exempted from continuation", async () => {
    //#given
    const childSessionID = "ses-sync-child-reused"
    const abortMock = mock(async () => ({ data: true }))
    await executeSync(args, createToolContext(), createExecuteContext(abortMock) as never, createDependencies(childSessionID, false))

    //#when
    const reawakened = await driveEnforcerIdle(childSessionID)

    //#then
    expect(abortMock).not.toHaveBeenCalled()
    expect(reawakened).toBe(true)
  })
})
