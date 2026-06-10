import { afterEach, describe, expect, it, mock, spyOn } from "bun:test"
import * as dispatchHookModule from "./dispatch-hook"
import { executePostToolUseHooks, type PostToolUseContext } from "./post-tool-use"
import type { ClaudeHooksConfig } from "./types"

function createContext(overrides?: Partial<PostToolUseContext>): PostToolUseContext {
  return {
    sessionId: "test-session",
    toolName: "write",
    toolInput: { file_path: "/tmp/test.md", content: "hello" },
    toolOutput: { output: "wrote file" },
    cwd: "/tmp",
    ...overrides,
  }
}

function createConfig(matchers: ClaudeHooksConfig["PostToolUse"]): ClaudeHooksConfig {
  return { PostToolUse: matchers }
}

describe("executePostToolUseHooks", () => {
  afterEach(() => {
    mock.restore()
  })

  it("#given hook JSON with multiline additional context #when PostToolUse runs #then it exposes readable context without raw JSON", async () => {
    // given
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "\r\nFirst line\r\n  indented second line\rThird line\r\n",
        },
      }),
      stderr: "",
    })
    const config = createConfig([
      { matcher: "Write", hooks: [{ type: "command", command: "hook-context" }] },
    ])

    // when
    const result = await executePostToolUseHooks(createContext(), config)

    // then
    expect(result.additionalContext).toBe("First line\n  indented second line\nThird line")
    expect(result.message).toBeUndefined()
  })

  it("#given non-json hook stdout with CRLF #when PostToolUse runs #then it normalizes the user-visible message", async () => {
    // given
    spyOn(dispatchHookModule, "dispatchHook").mockResolvedValue({
      exitCode: 0,
      stdout: "\r\nFirst line\r\nSecond line\rThird line\r\n",
      stderr: "",
    })
    const config = createConfig([
      { matcher: "Write", hooks: [{ type: "command", command: "hook-text" }] },
    ])

    // when
    const result = await executePostToolUseHooks(createContext(), config)

    // then
    expect(result.message).toBe("First line\nSecond line\nThird line")
  })
})
