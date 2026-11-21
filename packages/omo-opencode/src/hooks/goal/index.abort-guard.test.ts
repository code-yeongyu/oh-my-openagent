import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { ABORT_WINDOW_MS } from "../todo-continuation-enforcer/constants"
import { createGoalHook } from "./index"

const SESSION_ID = "ses_goal_abort"

const completedAssistant = {
  info: { id: "msg_a1", role: "assistant", finish: "stop", time: { created: 1, completed: 2 } },
  parts: [{ type: "text", text: "Working on it." }],
}

const abortedAssistant = {
  info: {
    id: "msg_a2",
    role: "assistant",
    time: { created: 3, completed: 4 },
    error: { name: "MessageAbortedError", data: { message: "The operation was aborted." } },
  },
  parts: [{ type: "text", text: "Partial" }],
}

const pendingQuestionAssistant = {
  info: { id: "msg_a3", role: "assistant", finish: "tool-calls", time: { created: 5 } },
  parts: [{ type: "tool", tool: "question", state: { status: "running" } }],
}

const pendingToolAssistant = {
  info: { id: "msg_a4", role: "assistant", finish: "tool-calls", time: { created: 6 } },
  parts: [{ type: "tool", tool: "read", state: { status: "running" } }],
}

const userMessage = {
  info: { id: "msg_u1", role: "user", time: { created: 0 } },
  parts: [{ type: "text", text: "Ship it" }],
}

const tempDirs: string[] = []

function makePluginInput(messages: () => Promise<unknown> | unknown): { ctx: PluginInput; promptCalls: string[] } {
  const promptCalls: string[] = []
  const directory = mkdtempSync(join(tmpdir(), "goal-abort-guard-"))
  tempDirs.push(directory)
  const ctx = {
    directory,
    client: {
      session: {
        messages,
        promptAsync: async (input: { path: { id: string } }) => {
          promptCalls.push(input.path.id)
          return {}
        },
      },
    },
  } as unknown as PluginInput
  return { ctx, promptCalls }
}

describe("createGoalHook idle continuation guards (#12976)", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("#given an active goal and a completed assistant turn #when the session goes idle #then the goal continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, completedAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([SESSION_ID])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })

  test("#given an active goal #when session.error reports MessageAbortedError before session.idle #then no continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, completedAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError", data: { message: "aborted" } } },
      },
    })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })

  test("#given an abort older than the abort window and a completed turn #when the session goes idle #then the goal continuation is dispatched", async () => {
    // given
    const openedAt = 1_700_000_000_000
    let clock = openedAt
    const nowSpy = spyOn(Date, "now").mockImplementation(() => clock)
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, completedAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: SESSION_ID, error: { name: "AbortError" } },
      },
    })
    clock = openedAt + ABORT_WINDOW_MS

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })
    nowSpy.mockRestore()

    // then
    expect(promptCalls).toEqual([SESSION_ID])
  })

  test("#given an active goal and an aborted last assistant message #when the session goes idle #then no continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, abortedAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })

  test("#given an active goal and an unanswered question tool call #when the session goes idle #then no continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, pendingQuestionAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("#given an active goal and an unresolved non-question tool call #when the session goes idle #then no continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: [userMessage, pendingToolAssistant] }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
  })

  test("#given an active goal #when session.messages fails #then no continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(async () => {
      throw new Error("db down")
    })
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })

  test("#given a user abort skipped the goal continuation #when the user's next turn completes #then the goal continuation resumes", async () => {
    // given
    let transcript: unknown[] = [userMessage, abortedAssistant]
    const { ctx, promptCalls } = makePluginInput(async () => ({ data: transcript }))
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")
    await hook.event({
      event: { type: "session.error", properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } } },
    })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })
    expect(promptCalls).toEqual([])

    // when
    transcript = [
      userMessage,
      abortedAssistant,
      { ...userMessage, info: { ...userMessage.info, id: "msg_u2" } },
      completedAssistant,
    ]
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([SESSION_ID])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })
})
