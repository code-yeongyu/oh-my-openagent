import { describe, it, expect, mock, beforeEach } from "bun:test"
import type { ClaudeHooksConfig } from "./types"
import type { StopContext } from "./stop"

const mockExecuteHookCommand = mock(() =>
  Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
)

mock.module("../../shared/command-executor", () => ({
  executeHookCommand: mockExecuteHookCommand,
  executeCommand: mock(),
  resolveCommandsInText: mock(),
}))

mock.module("../../shared/logger", () => ({
  log: () => {},
  getLogFilePath: () => "/tmp/test.log",
}))

const { executeStopHooks } = await import("./stop")

function createStopContext(overrides?: Partial<StopContext>): StopContext {
  return {
    sessionId: "test-session",
    cwd: "/tmp",
    ...overrides,
  }
}

function createConfig(stopHooks: ClaudeHooksConfig["Stop"]): ClaudeHooksConfig {
  return { Stop: stopHooks }
}

describe("executeStopHooks", () => {
  beforeEach(() => {
    mockExecuteHookCommand.mockReset()
    mockExecuteHookCommand.mockImplementation(() =>
      Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
    )
  })

  it("#given parent session #when stop hooks called #then skips execution", async () => {
    const ctx = createStopContext({ parentSessionId: "parent-session" })
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "echo test" }] },
    ])

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(false)
    expect(mockExecuteHookCommand).not.toHaveBeenCalled()
  })

  it("#given null config #when stop hooks called #then returns non-blocking", async () => {
    const ctx = createStopContext()

    const result = await executeStopHooks(ctx, null)

    expect(result.block).toBe(false)
    expect(mockExecuteHookCommand).not.toHaveBeenCalled()
  })

  it("#given empty stop hooks #when stop hooks called #then returns non-blocking", async () => {
    const ctx = createStopContext()
    const config = createConfig([])

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(false)
  })

  it("#given hook with exit code 2 #when stop hooks called #then blocks", async () => {
    const ctx = createStopContext()
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "exit 2" }] },
    ])
    mockExecuteHookCommand.mockResolvedValueOnce({
      exitCode: 2,
      stdout: "",
      stderr: "blocked reason",
    })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(true)
    expect(result.reason).toBe("blocked reason")
  })

  it("#given hook with decision=block #when stop hooks called #then blocks", async () => {
    const ctx = createStopContext()
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "blocker" }] },
    ])
    mockExecuteHookCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ decision: "block", reason: "must fix" }),
      stderr: "",
    })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(true)
    expect(result.reason).toBe("must fix")
  })

  it("#given first hook returns non-blocking JSON #when multiple hooks #then executes all hooks", async () => {
    const ctx = createStopContext()
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "hook-a" }] },
      { matcher: "*", hooks: [{ type: "command", command: "hook-b" }] },
    ])
    mockExecuteHookCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ suppressOutput: true }),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ suppressOutput: true }),
        stderr: "",
      })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(false)
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(2)
  })

  it("#given first hook returns stdin passthrough JSON #when multiple hooks #then executes all hooks", async () => {
    const ctx = createStopContext()
    const stdinPassthrough = {
      session_id: "test-session",
      hook_event_name: "Stop",
      hook_source: "opencode-plugin",
    }
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "check-console-log" }] },
      { matcher: "*", hooks: [{ type: "command", command: "task-complete-notify" }] },
    ])
    mockExecuteHookCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(stdinPassthrough),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ suppressOutput: true }),
        stderr: "",
      })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(false)
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(2)
  })

  it("#given first hook blocks #when multiple hooks #then stops at blocking hook", async () => {
    const ctx = createStopContext()
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "blocker" }] },
      { matcher: "*", hooks: [{ type: "command", command: "notifier" }] },
    ])
    mockExecuteHookCommand.mockResolvedValueOnce({
      exitCode: 0,
      stdout: JSON.stringify({ decision: "block", reason: "fix first" }),
      stderr: "",
    })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(true)
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(1)
  })

  it("#given hook with non-JSON stdout #when stop hooks called #then continues to next hook", async () => {
    const ctx = createStopContext()
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "hook-a" }] },
      { matcher: "*", hooks: [{ type: "command", command: "hook-b" }] },
    ])
    mockExecuteHookCommand
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "not json",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "",
        stderr: "",
      })

    const result = await executeStopHooks(ctx, config)

    expect(result.block).toBe(false)
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(2)
  })
})
