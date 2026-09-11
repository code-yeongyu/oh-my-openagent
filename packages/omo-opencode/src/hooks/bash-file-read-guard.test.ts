/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createBashFileReadGuardHook, WARNING_MESSAGE } from "./bash-file-read-guard"

type ToolExecuteAfterInput = {
  tool: string
  sessionID: string
  callID: string
  args?: Record<string, unknown>
}

type ToolExecuteAfterOutput = {
  title: string
  output: string
  metadata: Record<string, unknown>
}

describe("createBashFileReadGuardHook", () => {
  it("prepends warning in tool.execute.after for cat commands", async () => {
    const hook = createBashFileReadGuardHook()

    const afterInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: { command: "cat package.json" } }
    const afterOutput: ToolExecuteAfterOutput = { title: "Bash", output: '{"name": "test"}', metadata: {} }
    await hook["tool.execute.after"]?.(afterInput, afterOutput)

    expect(afterOutput.output).toContain("[WARNING: Prefer the Read tool over `cat`/`head`/`tail`")
    expect(afterOutput.output).toContain('{"name": "test"}')
  })

  it("prepends warning for head and tail commands", async () => {
    const hook = createBashFileReadGuardHook()

    const headInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: { command: "head -n 20 file.txt" } }
    const headOutput: ToolExecuteAfterOutput = { title: "Bash", output: "line 1\nline 2", metadata: {} }
    await hook["tool.execute.after"]?.(headInput, headOutput)
    expect(headOutput.output).toContain("[WARNING: Prefer the Read tool")

    const tailInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-2", args: { command: "tail -n 10 file.txt" } }
    const tailOutput: ToolExecuteAfterOutput = { title: "Bash", output: "line 9\nline 10", metadata: {} }
    await hook["tool.execute.after"]?.(tailInput, tailOutput)
    expect(tailOutput.output).toContain("[WARNING: Prefer the Read tool")
  })

  it("ignores non-bash tools", async () => {
    const hook = createBashFileReadGuardHook()

    const afterInput: ToolExecuteAfterInput = { tool: "read", sessionID: "ses-1", callID: "call-1", args: { filePath: "package.json" } }
    const afterOutput: ToolExecuteAfterOutput = { title: "Read", output: '{"name": "test"}', metadata: {} }
    await hook["tool.execute.after"]?.(afterInput, afterOutput)

    expect(afterOutput.output).toBe('{"name": "test"}')
  })

  it("ignores complex or piped bash commands", async () => {
    const hook = createBashFileReadGuardHook()

    const afterInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: { command: "cat file.txt | grep pattern" } }
    const afterOutput: ToolExecuteAfterOutput = { title: "Bash", output: "match", metadata: {} }
    await hook["tool.execute.after"]?.(afterInput, afterOutput)

    expect(afterOutput.output).toBe("match")
  })
  it("ignores unrelated bash commands", async () => {
    // given
    const hook = createBashFileReadGuardHook()
    const afterInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: { command: "echo hello" } }
    const afterOutput: ToolExecuteAfterOutput = { title: "Bash", output: "hello\n", metadata: {} }

    // when
    await hook["tool.execute.after"]?.(afterInput, afterOutput)

    // then
    expect(afterOutput.output).toBe("hello\n")
  })

  it("prepends warning exactly once and is idempotent", async () => {
    // given
    const hook = createBashFileReadGuardHook()
    const afterInput: ToolExecuteAfterInput = { tool: "bash", sessionID: "ses-1", callID: "call-1", args: { command: "cat package.json" } }
    const afterOutput: ToolExecuteAfterOutput = { title: "Bash", output: '{"name": "test"}', metadata: {} }

    // when
    await hook["tool.execute.after"]?.(afterInput, afterOutput)
    const firstOutput = afterOutput.output
    await hook["tool.execute.after"]?.(afterInput, afterOutput)

    // then
    expect(afterOutput.output).toBe(firstOutput)
    expect(afterOutput.output.indexOf(WARNING_MESSAGE)).toBe(afterOutput.output.lastIndexOf(WARNING_MESSAGE))
  })
})
