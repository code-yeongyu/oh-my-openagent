const { afterAll, afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")
const {
  preserveModuleMocksForTestFile,
  restoreModuleMocksForTestFile,
} = await import("../../testing/module-mock-lifecycle")

const capturedOptions: Array<Record<string, unknown>> = []

const mockExecuteHookCommand = mock(
  (_command: string, _stdin: string, _cwd: string, options?: Record<string, unknown>) => {
    capturedOptions.push(options ?? {})
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
  },
)

mock.module("../../shared/command-executor/execute-hook-command", () => ({
  executeHookCommand: mockExecuteHookCommand,
}))

mock.module("./execute-http-hook", () => ({
  executeHttpHook: mock(() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })),
}))
preserveModuleMocksForTestFile(import.meta.url)

const { dispatchHook } = await import("./dispatch-hook")

afterAll(() => {
  restoreModuleMocksForTestFile(import.meta.url)
})

describe("dispatchHook", () => {
  beforeEach(() => {
    mockExecuteHookCommand.mockClear()
    capturedOptions.length = 0
  })

  afterEach(() => {
    mockExecuteHookCommand.mockClear()
    capturedOptions.length = 0
  })

  test("#given HookCommand with allowedEnvVars #when dispatchHook called #then options include allowedEnvVars", async () => {
    // given
    const hook = {
      type: "command" as const,
      command: "echo hello",
      allowedEnvVars: ["MY_VAR"],
    }

    // when
    await dispatchHook(hook, "{}", "/tmp")

    // then
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(1)
    expect(capturedOptions.length).toBe(1)
    expect(capturedOptions[0].allowedEnvVars).toEqual(["MY_VAR"])
  })

  test("#given HookCommand without allowedEnvVars #when dispatchHook called #then options do NOT include allowedEnvVars", async () => {
    // given
    const hook = {
      type: "command" as const,
      command: "echo hello",
    }

    // when
    await dispatchHook(hook, "{}", "/tmp")

    // then
    expect(mockExecuteHookCommand).toHaveBeenCalledTimes(1)
    expect(capturedOptions.length).toBe(1)
    expect(capturedOptions[0].allowedEnvVars).toBeUndefined()
  })
})

export {}
