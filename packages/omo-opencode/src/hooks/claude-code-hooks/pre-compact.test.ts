import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as dispatchHookModule from "./dispatch-hook"
import { executePreCompactHooks, type PreCompactContext } from "./pre-compact"
import type { ClaudeHooksConfig } from "./types"

function createContext(overrides?: Partial<PreCompactContext>): PreCompactContext {
  return {
    sessionId: "test-session",
    cwd: "/tmp",
    ...overrides,
  }
}

function createConfig(matchers: ClaudeHooksConfig["PreCompact"]): ClaudeHooksConfig {
  return { PreCompact: matchers }
}

describe("executePreCompactHooks", () => {
  afterEach(() => {
    mock.restore()
  })

  it("#given hook context with CRLF and bare CR #when PreCompact runs #then it returns normalized context entries", async () => {
    // given
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreCompact",
          additionalContext: ["\r\nfirst context\r\n  detail\rsecond context\r\n"],
        },
      }),
      stderr: "",
    })
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "pre-compact-hook" }] },
    ])

    // when
    const result = await executePreCompactHooks(createContext(), config)

    // then
    expect(result.context).toEqual(["first context\n  detail\nsecond context"])
  })

  it("#given hook JSON parsing throws a non-Error value #when PreCompact runs #then raw stdout is preserved as context", async () => {
    // given
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: "raw hook context",
      stderr: "",
    })
    const thrownValue = "parse failed"
    const parseSpy = spyOn(JSON, "parse").mockImplementation(() => {
      throw thrownValue
    })
    const config = createConfig([
      { matcher: "*", hooks: [{ type: "command", command: "pre-compact-hook" }] },
    ])

    try {
      // when
      const result = await executePreCompactHooks(createContext(), config)

      // then
      expect(result.context).toEqual(["raw hook context"])
    } finally {
      parseSpy.mockRestore()
    }
  })
})
