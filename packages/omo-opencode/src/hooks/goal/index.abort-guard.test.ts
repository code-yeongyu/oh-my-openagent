import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import * as logger from "../../shared/logger"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
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

const userMessage = {
  info: { id: "msg_u1", role: "user", time: { created: 0 } },
  parts: [{ type: "text", text: "Ship it" }],
}

const tempDirs: string[] = []

function makePluginInput(transcript: () => unknown[]): { ctx: PluginInput; promptCalls: string[] } {
  const promptCalls: string[] = []
  const directory = mkdtempSync(join(tmpdir(), "goal-abort-guard-"))
  tempDirs.push(directory)
  const ctx = {
    directory,
    client: {
      session: {
        messages: async () => ({ data: transcript() }),
        promptAsync: async (input: { path: { id: string } }) => {
          promptCalls.push(input.path.id)
          return {}
        },
      },
    },
  } as unknown as PluginInput
  return { ctx, promptCalls }
}

function skipLogsFor(logSpy: ReturnType<typeof spyOn>): unknown[] {
  return logSpy.mock.calls
    .filter((call: unknown[]) => call[0] === "[goal] Skipped idle continuation")
    .map((call: unknown[]) => call[1])
}

describe("createGoalHook idle continuation guards (#12976)", () => {
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    logSpy = spyOn(logger, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
    releaseAllPromptAsyncReservationsForTesting()
    for (const directory of tempDirs.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  test("#given an active goal and a completed assistant turn #when the session goes idle #then the goal continuation is dispatched", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(() => [userMessage, completedAssistant])
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([SESSION_ID])
    expect(skipLogsFor(logSpy)).toEqual([])
  })

  test("#given an active goal #when session.error reports MessageAbortedError before session.idle #then no continuation is dispatched and the abort skip is logged", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(() => [userMessage, completedAssistant])
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
    expect(skipLogsFor(logSpy)).toEqual([expect.objectContaining({ sessionID: SESSION_ID, reason: "abort-window" })])
    expect(hook.getGoal(SESSION_ID)?.status).toBe("active")
  })

  test("#given an active goal and an aborted last assistant message #when the session goes idle #then no continuation is dispatched and the aborted-turn skip is logged", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(() => [userMessage, abortedAssistant])
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
    expect(skipLogsFor(logSpy)).toEqual([
      expect.objectContaining({ sessionID: SESSION_ID, reason: "last-assistant-aborted" }),
    ])
  })

  test("#given an active goal and an unanswered question tool call #when the session goes idle #then no continuation is dispatched and the question skip is logged", async () => {
    // given
    const { ctx, promptCalls } = makePluginInput(() => [userMessage, pendingQuestionAssistant])
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")

    // when
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([])
    expect(skipLogsFor(logSpy)).toEqual([expect.objectContaining({ sessionID: SESSION_ID, reason: "pending-question" })])
  })

  test("#given a user abort skipped the goal continuation #when the user's next turn completes #then the goal continuation resumes", async () => {
    // given
    let transcript: unknown[] = [userMessage, abortedAssistant]
    const { ctx, promptCalls } = makePluginInput(() => transcript)
    const hook = createGoalHook(ctx, { projectDir: ctx.directory })
    hook.setGoal(SESSION_ID, "Ship it")
    await hook.event({
      event: { type: "session.error", properties: { sessionID: SESSION_ID, error: { name: "MessageAbortedError" } } },
    })
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })
    expect(promptCalls).toEqual([])

    // when
    transcript = [userMessage, abortedAssistant, { ...userMessage, info: { ...userMessage.info, id: "msg_u2" } }, completedAssistant]
    await hook.event({ event: { type: "session.idle", properties: { sessionID: SESSION_ID } } })

    // then
    expect(promptCalls).toEqual([SESSION_ID])
  })
})
