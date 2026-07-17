import { describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../test-support/unsafe-test-value"

import { createCommandExecuteBeforeHandler } from "./command-execute-before"

describe("createCommandExecuteBeforeHandler", () => {
  test("#given stopped session and /ulw-loop #when command.execute.before runs #then clear is called", async () => {
    // given
    const clear = mock(() => {})
    const isStopped = mock(() => true)
    const startLoop = mock(() => true)
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        ralphLoop: {
          startLoop,
          cancelLoop: mock(() => true),
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
        command: "ulw-loop",
        sessionID: "ses-stopped",
        arguments: "Ship feature",
      },
      {
        parts: [],
      },
    )

    // then
    expect(startLoop).toHaveBeenCalledTimes(1)
    expect(isStopped).toHaveBeenCalledWith("ses-stopped")
    expect(clear).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith("ses-stopped")
  })

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

  test("#given non-stopped session and /ulw-loop #when command.execute.before runs #then clear is not called", async () => {
    // given
    const clear = mock(() => {})
    const isStopped = mock(() => false)
    const startLoop = mock(() => true)
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        ralphLoop: {
          startLoop,
          cancelLoop: mock(() => true),
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
        command: "ulw-loop",
        sessionID: "ses-running",
        arguments: "Ship feature",
      },
      {
        parts: [],
      },
    )

    // then
    expect(startLoop).toHaveBeenCalledTimes(1)
    expect(isStopped).toHaveBeenCalledWith("ses-running")
    expect(clear).not.toHaveBeenCalled()
  })

  test("#given active ultrawork loop state and /ulw-loop continue #when command.execute.before runs #then resumes without replacing prompt", async () => {
    // given
    const startLoop = mock(() => true)
    const resumeLoop = mock(() => true)
    const handler = createCommandExecuteBeforeHandler(unsafeTestValue({
      directory: process.cwd(),
      hooks: {
        ralphLoop: {
          startLoop,
          resumeLoop,
          cancelLoop: mock(() => true),
        },
      },
    }))

    // when
    await handler(
      {
        command: "ulw-loop",
        sessionID: "ses-resume",
        arguments: "continue",
      },
      {
        parts: [],
      },
    )

    // then
    expect(resumeLoop).toHaveBeenCalledWith("ses-resume")
    expect(startLoop).not.toHaveBeenCalled()
  })
})
