import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

import { createCommandExecuteBeforeHandler } from "./command-execute-before"

function createMockGoal() {
  return {
    id: "goal-id",
    sessionID: "ses-goal",
    objective: "Ship feature",
    status: "active" as const,
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 0,
    updatedAt: 0,
  }
}

describe("createCommandExecuteBeforeHandler", () => {
  test("#given stopped session and /start-work #when command.execute.before runs #then clear is called", async () => {
    // given
    const clear = mock(() => {})
    const isStopped = mock(() => true)
    const startWorkHook = mock(async () => {})
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        startWork: {
          "command.execute.before": startWorkHook,
        },
        stopContinuationGuard: {
          isStopped,
          clear,
        },
      },
    }))

    // when
    await handler(
      {
        command: "start-work",
        sessionID: "ses-stopped",
        arguments: "",
      },
      {
        parts: [],
      },
    )

    // then
    expect(startWorkHook).toHaveBeenCalledTimes(1)
    expect(isStopped).toHaveBeenCalledWith("ses-stopped")
    expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith("ses-stopped")
  })

  test("#given stopped session and /goal #when command.execute.before runs #then goal is set and clear is not called", async () => {
    // given
    const clear = mock(() => {})
    const isStopped = mock(() => true)
    const setGoal = mock(() => createMockGoal())
    const resumeGoal = mock(() => createMockGoal())
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        goal: {
          setGoal,
          getGoal: mock(() => null),
          pauseGoal: mock(() => null),
          resumeGoal,
          clearGoal: mock(() => true),
          markComplete: mock(() => null),
          event: mock(async () => {}),
        },
        stopContinuationGuard: {
          isStopped,
          clear,
        },
      },
    }))

    // when
    await handler(
      {
        command: "goal",
        sessionID: "ses-stopped",
        arguments: "Ship feature",
      },
      {
        parts: [],
      },
    )

    // then
    expect(setGoal).toHaveBeenCalledWith("ses-stopped", "Ship feature")
    expect(resumeGoal).not.toHaveBeenCalled()
    expect(isStopped).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  test("#given non-stopped session and /goal #when command.execute.before runs #then goal is set and clear is not called", async () => {
    // given
    const clear = mock(() => {})
    const isStopped = mock(() => false)
    const setGoal = mock(() => createMockGoal())
    const resumeGoal = mock(() => createMockGoal())
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        goal: {
          setGoal,
          getGoal: mock(() => null),
          pauseGoal: mock(() => null),
          resumeGoal,
          clearGoal: mock(() => true),
          markComplete: mock(() => null),
          event: mock(async () => {}),
        },
        stopContinuationGuard: {
          isStopped,
          clear,
        },
      },
    }))

    // when
    await handler(
      {
        command: "goal",
        sessionID: "ses-running",
        arguments: "Ship feature",
      },
      {
        parts: [],
      },
    )

    // then
    expect(setGoal).toHaveBeenCalledWith("ses-running", "Ship feature")
    expect(resumeGoal).not.toHaveBeenCalled()
    expect(isStopped).not.toHaveBeenCalled()
    expect(clear).not.toHaveBeenCalled()
  })

  test("#given active goal and /goal resume #when command.execute.before runs #then resumeGoal is called", async () => {
    // given
    const setGoal = mock(() => createMockGoal())
    const resumeGoal = mock(() => createMockGoal())
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        goal: {
          setGoal,
          getGoal: mock(() => createMockGoal()),
          pauseGoal: mock(() => null),
          resumeGoal,
          clearGoal: mock(() => true),
          markComplete: mock(() => null),
          event: mock(async () => {}),
        },
      },
    }))

    // when
    await handler(
      {
        command: "goal",
        sessionID: "ses-resume",
        arguments: "resume",
      },
      {
        parts: [],
      },
    )

    // then
    expect(setGoal).not.toHaveBeenCalled()
    expect(resumeGoal).toHaveBeenCalledWith("ses-resume")
  })
})
