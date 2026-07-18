import { describe, expect, spyOn, test } from "bun:test"
import { mkdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as sessionState from "../features/claude-code-session-state"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

describe("tool.execute.before goal command", () => {
  function createCtx(directory: string) {
    return {
      directory,
      client: {
        session: {
          messages: async () => ({ data: [] }),
        },
      },
    }
  }

  function createGoalHook(
    calls: Array<{ sessionID: string; objective: string }>,
  ) {
    return {
      setGoal: (sessionID: string, objective: string) => {
        calls.push({ sessionID, objective })
        return {
          id: `goal-${sessionID}`,
          sessionID,
          objective,
          status: "active" as const,
        }
      },
      getGoal: () => null,
      pauseGoal: () => null,
      resumeGoal: () => null,
      clearGoal: () => false,
      markComplete: () => null,
      event: async () => {},
    }
  }

  function createHandler(directory: string, goalHook: unknown) {
    return createToolExecuteBeforeHandler({
      ctx: unsafeTestValue<Parameters<typeof createToolExecuteBeforeHandler>[0]["ctx"]>(
        createCtx(directory),
      ),
      hooks: unsafeTestValue<Parameters<typeof createToolExecuteBeforeHandler>[0]["hooks"]>({
        goal: goalHook,
      }),
    })
  }

  test("#given /goal skill with user_message #when tool.execute.before runs #then goal.setGoal is called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-1" },
      { args: { name: "/goal", user_message: "Ship feature" } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill with arguments #when tool.execute.before runs #then goal.setGoal is called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-args-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-2" },
      { args: { name: "/goal", arguments: "Fix bug" } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Fix bug" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill with user_message and arguments #when tool.execute.before runs #then user_message takes precedence", async () => {
    const directory = join(tmpdir(), `tool-before-goal-precedence-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-3" },
      { args: { name: "/goal", user_message: "Ship feature", arguments: "Fix bug" } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill with no arguments #when tool.execute.before runs #then goal.setGoal is not called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-empty-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-4" },
      { args: { name: "/goal" } },
    )

    expect(calls).toHaveLength(0)

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill with whitespace-only arguments #when tool.execute.before runs #then goal.setGoal is not called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-ws-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-5" },
      { args: { name: "/goal", user_message: "   \n\t  " } },
    )

    expect(calls).toHaveLength(0)

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill with leading and trailing whitespace #when tool.execute.before runs #then objective is trimmed", async () => {
    const directory = join(tmpdir(), `tool-before-goal-trim-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-6" },
      { args: { name: "/goal", user_message: "  Ship feature  " } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /GOAL uppercase skill #when tool.execute.before runs #then goal.setGoal is called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-upper-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-7" },
      { args: { name: "/GOAL", user_message: "Ship feature" } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given skill name goal without leading slash #when tool.execute.before runs #then goal.setGoal is called", async () => {
    const directory = join(tmpdir(), `tool-before-goal-noslash-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-goal-8" },
      { args: { name: "goal", user_message: "Ship feature" } },
    )

    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given non-goal skill #when tool.execute.before runs #then goal.setGoal is not called", async () => {
    const directory = join(tmpdir(), `tool-before-non-goal-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "ses-main", callID: "call-start-work" },
      { args: { name: "/start-work", user_message: "Ship feature" } },
    )

    expect(calls).toHaveLength(0)

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given goal hook is null #when /goal skill runs #then no error occurs", async () => {
    const directory = join(tmpdir(), `tool-before-null-goal-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const handler = createHandler(directory, null)

    await expect(
      handler(
        { tool: "skill", sessionID: "ses-main", callID: "call-goal-9" },
        { args: { name: "/goal", user_message: "Ship feature" } },
      ),
    ).resolves.toBeUndefined()

    rmSync(directory, { recursive: true, force: true })
  })

  test("#given /goal skill without sessionID #when tool.execute.before runs #then falls back to main session ID", async () => {
    const getMainSessionIDSpy = spyOn(sessionState, "getMainSessionID").mockReturnValue("ses-main")
    const directory = join(tmpdir(), `tool-before-goal-main-${Date.now()}`)
    mkdirSync(directory, { recursive: true })
    const calls: Array<{ sessionID: string; objective: string }> = []
    const handler = createHandler(directory, createGoalHook(calls))

    await handler(
      { tool: "skill", sessionID: "", callID: "call-goal-10" },
      { args: { name: "/goal", user_message: "Ship feature" } },
    )

    expect(getMainSessionIDSpy).toHaveBeenCalled()
    expect(calls).toEqual([{ sessionID: "ses-main", objective: "Ship feature" }])

    getMainSessionIDSpy.mockRestore()
    rmSync(directory, { recursive: true, force: true })
  })
})
