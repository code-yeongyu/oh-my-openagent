import { describe, expect, test } from "bun:test"

import type { BackgroundTask, BackgroundTaskStatus } from "../../features/background-agent"
import { createBackgroundToolOutputNotifierHook } from "./hook"

function createTask(args: {
  id: string
  description: string
  status: BackgroundTaskStatus
  error?: string
}): BackgroundTask {
  return {
    id: args.id,
    parentSessionID: "ses_main",
    parentMessageID: "msg_1",
    description: args.description,
    prompt: "",
    agent: "explore",
    status: args.status,
    ...(args.error ? { error: args.error } : {}),
  }
}

describe("createBackgroundToolOutputNotifierHook", () => {
  test("does nothing when no pending notifications", async () => {
    const manager = {
      getPendingNotifications: (_sessionID: string) => [] as BackgroundTask[],
      clearNotifications: (_sessionID: string) => {},
    }

    const hook = createBackgroundToolOutputNotifierHook(manager)
    const output = { title: "bash", output: "ok", metadata: {} }

    await hook["tool.execute.after"]({
      tool: "bash",
      sessionID: "ses_main",
      callID: "call_1",
    }, output)

    expect(output.output).toBe("ok")
  })

  test("prepends summary and clears notifications", async () => {
    const pending = [
      createTask({ id: "bg_1", description: "Collect API docs", status: "completed" }),
    ]
    const cleared: string[] = []

    const manager = {
      getPendingNotifications: (_sessionID: string) => pending,
      clearNotifications: (sessionID: string) => {
        cleared.push(sessionID)
      },
    }

    const hook = createBackgroundToolOutputNotifierHook(manager)
    const output = { title: "read", output: "result", metadata: {} }

    await hook["tool.execute.after"]({
      tool: "read",
      sessionID: "ses_main",
      callID: "call_2",
    }, output)

    expect(output.output.startsWith("[BACKGROUND TASK UPDATES]")).toBe(true)
    expect(output.output).toContain("COMPLETED | bg_1 | Collect API docs")
    expect(output.output).toContain('background_output(task_id="<id>")')
    expect(output.output.endsWith("result")).toBe(true)
    expect(cleared).toEqual(["ses_main"])
  })

  test("includes multiple tasks and error details", async () => {
    const pending = [
      createTask({ id: "bg_1", description: "Run tests", status: "completed" }),
      createTask({ id: "bg_2", description: "Build app", status: "error", error: "Build failed" }),
      createTask({ id: "bg_3", description: "Lint", status: "cancelled" }),
    ]

    const manager = {
      getPendingNotifications: (_sessionID: string) => pending,
      clearNotifications: (_sessionID: string) => {},
    }

    const hook = createBackgroundToolOutputNotifierHook(manager)
    const output = { title: "bash", output: "done", metadata: {} }

    await hook["tool.execute.after"]({
      tool: "bash",
      sessionID: "ses_main",
      callID: "call_3",
    }, output)

    expect(output.output).toContain("COMPLETED | bg_1 | Run tests")
    expect(output.output).toContain("ERROR | bg_2 | Build app | error: Build failed")
    expect(output.output).toContain("CANCELLED | bg_3 | Lint")
  })

  test("handles empty output by writing notification block only", async () => {
    const pending = [
      createTask({ id: "bg_9", description: "Sync branch", status: "interrupt" }),
    ]

    const manager = {
      getPendingNotifications: (_sessionID: string) => pending,
      clearNotifications: (_sessionID: string) => {},
    }

    const hook = createBackgroundToolOutputNotifierHook(manager)
    const output = { title: "task", output: "", metadata: {} }

    await hook["tool.execute.after"]({
      tool: "task",
      sessionID: "ses_main",
      callID: "call_4",
    }, output)

    expect(output.output.startsWith("[BACKGROUND TASK UPDATES]")).toBe(true)
    expect(output.output).toContain("INTERRUPTED | bg_9 | Sync branch")
  })

  test("sanitizes multiline task text and truncates long fields", async () => {
    const longSuffix = "x".repeat(800)
    const pending = [
      createTask({
        id: "bg_10",
        description: `Run\nmultiline\ttask ${longSuffix}`,
        status: "error",
        error: "line1\r\nline2\nline3",
      }),
    ]

    const manager = {
      getPendingNotifications: (_sessionID: string) => pending,
      clearNotifications: (_sessionID: string) => {},
    }

    const hook = createBackgroundToolOutputNotifierHook(manager)
    const output = { title: "task", output: "ok", metadata: {} }

    await hook["tool.execute.after"]({
      tool: "task",
      sessionID: "ses_main",
      callID: "call_5",
    }, output)

    expect(output.output).toContain("ERROR | bg_10 | Run multiline task")
    expect(output.output).toContain("| error: line1 line2 line3")
    expect(output.output).toContain("...")
    expect(output.output).not.toContain("\nmultiline")
    expect(output.output).not.toContain("\r\n")
  })
})
