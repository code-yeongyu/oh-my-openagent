/// <reference types="bun-types" />

import { describe, it, expect, mock, beforeEach, afterEach, spyOn } from "bun:test"
import type { ClaudeHooksConfig } from "./types"
import type { PreToolUseContext } from "./pre-tool-use"
import * as dispatchHookModule from "./dispatch-hook"
import * as logger from "../../shared/logger"
import { executePreToolUseHooks } from "./pre-tool-use"

function createContext(overrides?: Partial<PreToolUseContext>): PreToolUseContext {
  return {
    sessionId: "test-session",
    toolName: "write",
    toolInput: { file_path: "/tmp/test.md", content: "hello" },
    cwd: "/tmp",
    ...overrides,
  }
}

function createConfig(matchers: ClaudeHooksConfig["PreToolUse"]): ClaudeHooksConfig {
  return { PreToolUse: matchers }
}

describe("executePreToolUseHooks", () => {
  let dispatchSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    dispatchSpy = spyOn(dispatchHookModule, "dispatchHook")
    spyOn(logger, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    mock.restore()
  })

  it("#given null config #when called #then returns allow", async () => {
    const result = await executePreToolUseHooks(createContext(), null)
    expect(result.decision).toBe("allow")
  })

  it("#given no matching hooks #when called #then returns allow", async () => {
    const config = createConfig([
      { matcher: "Bash", hooks: [{ type: "command", command: "echo test" }] },
    ])
    const result = await executePreToolUseHooks(createContext({ toolName: "write" }), config)
    expect(result.decision).toBe("allow")
  })

  it("#given hook returns exit code 2 #when called #then returns deny", async () => {
    dispatchSpy.mockResolvedValue({ exitCode: 2, stdout: "", stderr: "blocked" })

    const config = createConfig([
      { matcher: "Write", hooks: [{ type: "command", command: "echo deny" }] },
    ])
    const result = await executePreToolUseHooks(createContext(), config)

    expect(result.decision).toBe("deny")
    expect(result.reason).toBe("blocked")
  })

  it("#given hook returns exit code 1 #when called #then returns ask", async () => {
    dispatchSpy.mockResolvedValue({ exitCode: 1, stdout: "", stderr: "needs confirmation" })

    const config = createConfig([
      { matcher: "Write", hooks: [{ type: "command", command: "echo ask" }] },
    ])
    const result = await executePreToolUseHooks(createContext(), config)

    expect(result.decision).toBe("ask")
    expect(result.reason).toBe("needs confirmation")
  })

  describe("#given multiple hooks with merged config (global + project)", () => {
    it("#when first hook allows and second hook denies #then returns deny", async () => {
      let callCount = 0
      dispatchSpy.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // Global catch-all hook returns "allow" via JSON
          return {
            exitCode: 0,
            stdout: JSON.stringify({ decision: "allow" }),
            stderr: "",
          }
        }
        // Project budget guard hook returns exit code 2 (deny)
        return { exitCode: 2, stdout: "", stderr: "BUDGET EXCEEDED" }
      })

      const config = createConfig([
        // Global catch-all (no specific matcher = matches everything)
        { matcher: "*", hooks: [{ type: "command", command: "node pre-tool-use.mjs" }] },
        // Project budget guard
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash budget-guard.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(callCount).toBe(2)
      expect(result.decision).toBe("deny")
      expect(result.reason).toBe("BUDGET EXCEEDED")
    })

    it("#when first hook allows and second hook also allows #then returns allow", async () => {
      let callCount = 0
      dispatchSpy.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({ decision: "allow" }),
            stderr: "",
          }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      })

      const config = createConfig([
        { matcher: "*", hooks: [{ type: "command", command: "node pre-tool-use.mjs" }] },
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash budget-guard.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(callCount).toBe(2)
      expect(result.decision).toBe("allow")
    })

    it("#when first hook denies #then second hook is NOT executed", async () => {
      let callCount = 0
      dispatchSpy.mockImplementation(async () => {
        callCount++
        return { exitCode: 2, stdout: "", stderr: "denied by first hook" }
      })

      const config = createConfig([
        { matcher: "*", hooks: [{ type: "command", command: "node pre-tool-use.mjs" }] },
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash budget-guard.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(callCount).toBe(1)
      expect(result.decision).toBe("deny")
    })

    it("#when first hook allows via JSON with modifiedInput #then input is passed to second hook", async () => {
      const capturedStdin: string[] = []
      let callCount = 0
      dispatchSpy.mockImplementation(async (_hook: unknown, stdinJson: string) => {
        capturedStdin.push(stdinJson)
        callCount++
        if (callCount === 1) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              decision: "allow",
            }),
            stderr: "",
          }
        }
        return { exitCode: 0, stdout: "", stderr: "" }
      })

      const config = createConfig([
        { matcher: "*", hooks: [{ type: "command", command: "node pre-tool-use.mjs" }] },
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash budget-guard.sh" }] },
      ])

      await executePreToolUseHooks(createContext(), config)

      expect(callCount).toBe(2)
    })

    it("#when hook returns allow with updatedInput #then modifiedInput is included in final result", async () => {
      dispatchSpy.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          decision: "allow",
          hookSpecificOutput: {
            permissionDecision: "allow",
            updatedInput: { file_path: "/tmp/modified.md" },
          },
        }),
        stderr: "",
      })

      const config = createConfig([
        { matcher: "Write", hooks: [{ type: "command", command: "bash modifier.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(result.decision).toBe("allow")
      expect(result.modifiedInput).toEqual({ file_path: "/tmp/modified.md" })
    })

    it("#when hook returns allow with common fields #then fields are included in final result", async () => {
      dispatchSpy.mockResolvedValue({
        exitCode: 0,
        stdout: JSON.stringify({
          decision: "allow",
          suppressOutput: true,
          systemMessage: "Budget warning: approaching limit",
        }),
        stderr: "",
      })

      const config = createConfig([
        { matcher: "Write", hooks: [{ type: "command", command: "bash checker.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(result.decision).toBe("allow")
      expect(result.suppressOutput).toBe(true)
      expect(result.systemMessage).toBe("Budget warning: approaching limit")
    })

    it("#when first hook allows with modifiedInput and second hook denies #then deny includes accumulated modifiedInput", async () => {
      let callCount = 0
      dispatchSpy.mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              decision: "allow",
              hookSpecificOutput: {
                permissionDecision: "allow",
                updatedInput: { file_path: "/tmp/modified.md" },
              },
            }),
            stderr: "",
          }
        }
        return { exitCode: 2, stdout: "", stderr: "BUDGET EXCEEDED" }
      })

      const config = createConfig([
        { matcher: "*", hooks: [{ type: "command", command: "node modifier.mjs" }] },
        { matcher: "Edit|Write", hooks: [{ type: "command", command: "bash budget-guard.sh" }] },
      ])

      const result = await executePreToolUseHooks(createContext(), config)

      expect(callCount).toBe(2)
      expect(result.decision).toBe("deny")
      expect(result.modifiedInput).toEqual({ file_path: "/tmp/modified.md" })
    })
  })
})
