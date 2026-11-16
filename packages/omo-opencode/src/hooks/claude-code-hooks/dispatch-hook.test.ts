const { afterEach, beforeEach, describe, expect, mock, spyOn, test } = require("bun:test")
import * as sharedModule from "../../shared"
import { dispatchHook } from "./dispatch-hook"
import * as executeHttpHookModule from "./execute-http-hook"

const capturedOptions: Array<Record<string, unknown>> = []

const mockExecuteHookCommand = mock(
  (_command: string, _stdin: string, _cwd: string, options?: Record<string, unknown>) => {
    capturedOptions.push(options ?? {})
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" })
  },
)

// Spies on the modules dispatch-hook imports, undone by mock.restore() after each test. Module mocks of these leaked
// into later test files whenever another file had already loaded dispatch-hook (#13331).
describe("dispatchHook", () => {
  beforeEach(() => {
    mockExecuteHookCommand.mockClear()
    capturedOptions.length = 0
    spyOn(sharedModule, "executeHookCommand").mockImplementation(mockExecuteHookCommand)
    spyOn(executeHttpHookModule, "executeHttpHook").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
  })

  afterEach(() => {
    mock.restore()
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
