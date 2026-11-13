const { afterAll, afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")
const { preserveModuleMocksForTestFile, restoreModuleMocksForTestFile } =
  await import("../../testing/module-mock-lifecycle")

const capturedOptions: Array<Record<string, unknown>> = []

const mockExecuteHookCommand = mock(
  (_command: string, _stdin: string, _cwd: string, options?: Record<string, unknown>) => {
    capturedOptions.push(options ?? {})
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
  },
)

// Complete module mocks: once bun has built a module from a mock factory, that module keeps the factory's export names
// for the rest of the process, so a partial mock hides the real exports from every later test file even after the
// restore (#13331). Each factory spreads the real module and overrides only what this file controls.
const actualExecuteHookCommand = await import("../../shared/command-executor/execute-hook-command")
const actualExecuteHttpHook = await import("./execute-http-hook")

mock.module("../../shared/command-executor/execute-hook-command", () => ({
  ...actualExecuteHookCommand,
  executeHookCommand: mockExecuteHookCommand,
}))

mock.module("./execute-http-hook", () => ({
  ...actualExecuteHttpHook,
  executeHttpHook: mock(() => Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })),
}))
preserveModuleMocksForTestFile(import.meta.url)

// A fresh copy binds the mocks above; the shared ./dispatch-hook module stays linked to the real modules (#13331).
const { dispatchHook } = await import("./dispatch-hook?dispatch-hook-test")

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
