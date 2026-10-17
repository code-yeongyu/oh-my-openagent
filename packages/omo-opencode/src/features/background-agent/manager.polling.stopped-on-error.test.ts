/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import { MIN_ERRORED_IDLE_POLLS } from "./session-stopped-on-error"
import type { BackgroundTask } from "./types"

type SessionMessage = { info: { role: string; error?: unknown }; parts: Array<{ type: string; text?: string }> }

const ERRORED_TURN: SessionMessage[] = [
  { info: { role: "user" }, parts: [{ type: "text", text: "find nothing" }] },
  {
    info: {
      role: "assistant",
      error: { name: "APIError", data: { message: "Rate limit reached for requests", statusCode: 429 } },
    },
    parts: [],
  },
]

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function createManager(state: { status: string; messages: SessionMessage[] }, sessionID: string): BackgroundManager {
  const client = {
    session: {
      status: async () => ({ data: { [sessionID]: { type: state.status } } }),
      get: async () => ({ data: { id: sessionID } }),
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: state.messages }),
    },
  }
  return new BackgroundManager(
    { pluginContext: createPluginContext(client), config: undefined, enableParentSessionNotifications: false },
  )
}

function createRunningTask(sessionId: string): BackgroundTask {
  return {
    id: `bg_test_${sessionId}`,
    sessionId,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "test task",
    prompt: "test",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
  }
}

async function pollTimes(manager: BackgroundManager, times: number): Promise<void> {
  const poll = manager["pollRunningTasks"]
  for (let index = 0; index < times; index++) {
    await poll.call(manager)
  }
}

describe("BackgroundManager polling a session that stopped on an error", () => {
  test("#given an idle session ending on an errored turn #when it stays that way #then the task fails with the error", async () => {
    // given
    const state = { status: "idle", messages: ERRORED_TURN }
    const manager = createManager(state, "ses-stopped")
    const task = createRunningTask("ses-stopped")
    manager["tasks"].set(task.id, task)

    // when
    await pollTimes(manager, MIN_ERRORED_IDLE_POLLS)
    await manager.shutdown()

    // then
    expect(task.status).toBe("error")
    expect(task.error).toContain("Rate limit reached for requests")
  })

  test("#given an idle session ending on an errored turn #when fewer polls than the threshold ran #then the task keeps waiting", async () => {
    // given
    const state = { status: "idle", messages: ERRORED_TURN }
    const manager = createManager(state, "ses-grace")
    const task = createRunningTask("ses-grace")
    manager["tasks"].set(task.id, task)

    // when
    await pollTimes(manager, MIN_ERRORED_IDLE_POLLS - 1)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.consecutiveErroredIdlePolls).toBe(MIN_ERRORED_IDLE_POLLS - 1)
  })

  test("#given an errored idle session #when a recovery prompt resumes it before the threshold #then the task is not failed", async () => {
    // given
    const state = { status: "idle", messages: ERRORED_TURN }
    const manager = createManager(state, "ses-recovered")
    const task = createRunningTask("ses-recovered")
    manager["tasks"].set(task.id, task)
    await pollTimes(manager, MIN_ERRORED_IDLE_POLLS - 1)

    // when
    state.status = "busy"
    state.messages = [...ERRORED_TURN, { info: { role: "user" }, parts: [{ type: "text", text: "retry" }] }]
    await pollTimes(manager, 1)
    state.status = "idle"
    await pollTimes(manager, MIN_ERRORED_IDLE_POLLS - 1)
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.consecutiveErroredIdlePolls).toBe(0)
  })
})
