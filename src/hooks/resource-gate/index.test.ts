
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { MemoryStatus } from "./index"

const mockCheckMacOSMemory = mock(() => ({
  availableGB: 8,
  usedPercent: 50,
  swapUsedPercent: 10,
  recommendation: "parallelize_5" as const,
}))

mock.module("./memory-check", () => ({
  checkMacOSMemory: mockCheckMacOSMemory,
}))

const { createResourceGateHook } = await import("./index")

type Hook = ReturnType<typeof createResourceGateHook>

describe("createResourceGateHook", () => {
  let hook: Hook
  let callCounter = 0

  const invoke = async (input: {
    tool: string
    runInBackground?: boolean
    description?: string
  }): Promise<{ args: Record<string, unknown> }> => {
    callCounter += 1
    const output: { args: Record<string, unknown> } = {
      args: { run_in_background: input.runInBackground },
    }
    if (typeof input.description === "string") {
      output.args.description = input.description
    }

    await hook["tool.execute.before"](
      {
        tool: input.tool,
        sessionID: "ses_resource_gate",
        callID: `call_${callCounter}`,
      },
      output,
    )

    return output
  }

  const setMemory = (overrides: Partial<MemoryStatus>): void => {
    mockCheckMacOSMemory.mockReturnValue({
      availableGB: 8,
      usedPercent: 50,
      swapUsedPercent: 10,
      recommendation: "parallelize_5",
      ...overrides,
    })
  }

  beforeEach(() => {
    hook = createResourceGateHook({ directory: "/tmp" } as never)
    callCounter = 0
    mockCheckMacOSMemory.mockReset()
    setMemory({})
  })

  test("#given non-task tool #when tool executes #then passes through", async () => {
    const output = await invoke({ tool: "bash", runInBackground: true, description: "keep me" })

    expect(output.args.description).toBe("keep me")
    expect(mockCheckMacOSMemory).not.toHaveBeenCalled()
  })

  test("#given task tool with run_in_background=false #when tool executes #then passes through", async () => {
    const output = await invoke({ tool: "task", runInBackground: false, description: "stay" })

    expect(output.args.description).toBe("stay")
    expect(mockCheckMacOSMemory).not.toHaveBeenCalled()
  })

  test("#given task background run with plenty memory #when tool executes #then passes through", async () => {
    setMemory({ availableGB: 5.2, usedPercent: 70, recommendation: "parallelize_5" })

    const output = await invoke({ tool: "task", runInBackground: true, description: "parallel" })

    expect(output.args.description).toBe("parallel")
    expect(mockCheckMacOSMemory).toHaveBeenCalledTimes(1)
  })

  test("#given task background run with warning memory #when tool executes #then injects warning into description", async () => {
    setMemory({ availableGB: 1.5, usedPercent: 80, recommendation: "serialize" })

    const output = await invoke({ tool: "task", runInBackground: true, description: "start" })

    expect(String(output.args.description)).toContain("start [MEMORY WARNING: 1.5GB free, 80% used")
    expect(String(output.args.description)).toContain("recommendation: serialize")
  })

  test("#given task background run with high percent used #when tool executes #then injects warning into description", async () => {
    setMemory({ availableGB: 3.4, usedPercent: 89, recommendation: "parallelize_2" })

    const output = await invoke({ tool: "task", runInBackground: true, description: "already set" })

    expect(String(output.args.description)).toContain("3.4GB free, 89% used")
    expect(String(output.args.description)).toContain("recommendation: parallelize_2")
  })

  test("#given task background run with critical memory #when tool executes #then throws Resource Gate error", async () => {
    setMemory({ availableGB: 0.8, usedPercent: 92, recommendation: "wait" })

    expect(invoke({ tool: "task", runInBackground: true, description: "blocked" })).rejects.toThrow(
      "Resource Gate",
    )
  })

  test("#given vm_stat failure fallback status #when task runs in background #then does not throw", async () => {
    setMemory({ availableGB: 4.3, usedPercent: 40, recommendation: "parallelize_5" })

    expect(invoke({ tool: "task", runInBackground: true, description: "fallback" })).resolves.toBeDefined()
  })

  test("#given task background warning with no existing description #when tool executes #then sets warning text", async () => {
    setMemory({ availableGB: 1.7, usedPercent: 75, recommendation: "serialize" })

    const output = await invoke({ tool: "task", runInBackground: true })

    expect(String(output.args.description)).toMatch(/^\[MEMORY WARNING:/)
    expect(String(output.args.description)).toContain("recommendation: serialize")
  })

  test("#given task background warning with existing description #when tool executes #then appends warning", async () => {
    setMemory({ availableGB: 1.9, usedPercent: 70, recommendation: "serialize" })

    const output = await invoke({
      tool: "task",
      runInBackground: true,
      description: "Investigate flake",
    })

    expect(String(output.args.description)).toContain("Investigate flake [MEMORY WARNING:")
    expect(String(output.args.description)).toContain("1.9GB free, 70% used")
  })
})
