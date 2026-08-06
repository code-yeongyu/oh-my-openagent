/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { _resetForTesting } from "../../features/claude-code-session-state"
import { handleSessionIdle } from "../../hooks/todo-continuation-enforcer/idle-event"
import { createSessionStateStore } from "../../hooks/todo-continuation-enforcer/session-state"
import { executeSyncTask } from "./sync-task"

const CHILD_SESSION_ID = "ses_test_5112_child"

function createDeps() {
  return {
    createSyncSession: async () => ({ ok: true as const, sessionID: CHILD_SESSION_ID, parentDirectory: "/tmp" }),
    sendSyncPrompt: async () => null,
    pollSyncSession: async () => null,
    fetchSyncResult: async () => ({ ok: false as const, error: "Fetch failed" }),
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

describe("issue #5112 - delegate-task sync child must not be re-awakened after handoff", () => {
  beforeEach(() => {
    const { __setTimingConfig } = require("./timing")
    __setTimingConfig({
      POLL_INTERVAL_MS: 10,
      MIN_STABILITY_TIME_MS: 0,
      STABILITY_POLLS_REQUIRED: 1,
      MAX_POLL_TIME_MS: 100,
    })
    const { initTaskToastManager, _resetTaskToastManagerForTesting } = require("../../features/task-toast-manager/manager")
    _resetTaskToastManagerForTesting()
    initTaskToastManager({
      tui: { showToast: mock(() => Promise.resolve()) },
    })
  })

  afterEach(() => {
    const { __resetTimingConfig } = require("./timing")
    __resetTimingConfig()
    const { _resetTaskToastManagerForTesting } = require("../../features/task-toast-manager/manager")
    _resetTaskToastManagerForTesting()
    _resetForTesting()
  })

  test("#given a sync task whose session was created and handed back #when the child later idles #then todo-continuation does not re-awaken it and the child was aborted", async () => {
    //#given
    const abortMock = mock(async () => ({ data: true }))
    const mockCtx = { sessionID: "parent-session", callID: "call-123", metadata: () => {} }
    const mockExecutorCtx = {
      client: {
        session: {
          create: async () => ({ data: { id: CHILD_SESSION_ID } }),
          abort: abortMock,
        },
      },
      directory: "/tmp",
      onSyncSessionCreated: null,
    }
    const args = {
      prompt: "test prompt",
      description: "test task",
      category: "test",
      load_skills: [],
      run_in_background: false,
      command: null,
    }
    await executeSyncTask(args as never, mockCtx as never, mockExecutorCtx as never, {
      sessionID: "parent-session",
    } as never, "test-agent", undefined, undefined, undefined, undefined, createDeps() as never)

    //#when
    const store = createSessionStateStore()
    await handleSessionIdle({
      ctx: createEnforcerContext() as never,
      sessionID: CHILD_SESSION_ID,
      sessionStateStore: store,
      backgroundManager: { getTasksByParentSession: () => [] } as never,
    })
    const countdownArmed = store.getState(CHILD_SESSION_ID).countdownStartedAt !== undefined
    store.cancelCountdown(CHILD_SESSION_ID)

    //#then
    expect(abortMock).toHaveBeenCalledWith({ path: { id: CHILD_SESSION_ID } })
    expect(countdownArmed).toBe(false)
  })
})
