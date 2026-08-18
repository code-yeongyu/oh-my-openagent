/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

import type { AgentToolResult, ExtensionContext } from "@code-yeongyu/senpi"

import type { DshRunOutcome, DshRunRequest, DshRunner } from "../../runners/dsh"
import type { CallDshAgentDetails } from "./types"

const runMock = mock(
  async (_request: DshRunRequest): Promise<DshRunOutcome> => ({
    output: "done",
    stopReason: "completed",
    exitCode: 0,
    verified: false,
  }),
)

class MockDshRunner {
  run = runMock
}

const { createCallDshAgentTool, CALL_DSH_AGENT_TOOL_NAME } = await import("./tool")

function makeTool(): ReturnType<typeof createCallDshAgentTool> {
  return createCallDshAgentTool({ runner: new MockDshRunner() as unknown as DshRunner })
}

function fakeContext(): ExtensionContext {
  return { signal: new AbortController().signal } as unknown as ExtensionContext
}

function firstText(result: AgentToolResult<CallDshAgentDetails>): string {
  const first = result.content[0]
  return first?.type === "text" ? first.text : ""
}

describe("createCallDshAgentTool", () => {
  test("#given deps #when the tool is created #then it exposes the call_dsh_agent ToolDefinition surface", () => {
    // given
    const tool = makeTool()

    // then
    expect(tool.name).toBe(CALL_DSH_AGENT_TOOL_NAME)
    expect(tool.name).toBe("call_dsh_agent")
    expect(tool.label).toBe("Call DSH Agent")
    expect(tool.description.length).toBeGreaterThan(0)
    expect(tool.parameters.type).toBe("object")
    expect(Object.keys(tool.parameters.properties)).toEqual(["prompt", "cwd", "verify"])
  })

  test("#given a headless-style outcome #when executed #then the title shows the exit code", async () => {
    // given
    runMock.mockClear()
    const tool = makeTool()

    // when
    const result = await tool.execute("call_1", { prompt: "fix the widget" }, undefined, undefined, fakeContext())

    // then
    expect(firstText(result).split("\n")[0]).toBe("dsh agent (exit 0)")
    expect(firstText(result)).toContain("done")
    expect(result.details).toEqual({ stopReason: "completed", exitCode: 0, verified: false })
  })

  test("#given an acp-style outcome #when executed #then the title shows the stop reason", async () => {
    // given
    runMock.mockClear()
    runMock.mockResolvedValueOnce({ output: "acp done", stopReason: "end_turn", exitCode: null, verified: false })
    const tool = makeTool()

    // when
    const result = await tool.execute("call_1", { prompt: "fix the widget" }, undefined, undefined, fakeContext())

    // then
    expect(firstText(result).split("\n")[0]).toBe("dsh agent (end_turn)")
    expect(result.details).toEqual({ stopReason: "end_turn", exitCode: null, verified: false })
  })

  test("#given a verify gate that passes #when executed #then the title shows verified", async () => {
    // given
    runMock.mockClear()
    runMock.mockResolvedValueOnce({
      output: "test run ok",
      stopReason: "completed",
      exitCode: 0,
      verified: true,
      verify: "bun test",
    })
    const tool = makeTool()

    // when
    const result = await tool.execute("call_1", { prompt: "fix", verify: "bun test" }, undefined, undefined, fakeContext())

    // then
    expect(firstText(result).split("\n")[0]).toBe("dsh agent (verified)")
    expect(result.details).toEqual({
      stopReason: "completed",
      exitCode: 0,
      verified: true,
      verify: "bun test",
    })
  })

  test("#given a verify gate that fails #when executed #then the title flags VERIFICATION FAILED and evidence is in the details", async () => {
    // given
    runMock.mockClear()
    runMock.mockResolvedValueOnce({
      output: "test run failed\n\n--- VERIFICATION FAILED ---\nexpected 1 fail\n--- END VERIFICATION ---",
      stopReason: "completed",
      exitCode: 0,
      verified: false,
      verify: "bun test",
      evidence: "expected 1 fail",
    })
    const tool = makeTool()

    // when
    const result = await tool.execute("call_1", { prompt: "fix", verify: "bun test" }, undefined, undefined, fakeContext())

    // then
    expect(firstText(result).split("\n")[0]).toBe("dsh agent (VERIFICATION FAILED)")
    expect(firstText(result)).toContain("--- VERIFICATION FAILED ---")
    expect(firstText(result)).toContain("--- END VERIFICATION ---")
    expect(result.details.verified).toBe(false)
    expect(result.details.evidence).toBe("expected 1 fail")
  })

  test("#given prompt, cwd, and verify params #when executed #then runner.run receives them plus the ctx abort signal", async () => {
    // given
    runMock.mockClear()
    const tool = makeTool()
    const ctxSignal = new AbortController().signal
    const ctx = { signal: ctxSignal } as unknown as ExtensionContext

    // when
    await tool.execute("call_1", { prompt: "fix the widget", cwd: "/explicit/dir", verify: "bun test" }, undefined, undefined, ctx)
    await tool.execute("call_2", { prompt: "plain" }, undefined, undefined, ctx)

    // then
    expect(runMock).toHaveBeenCalledTimes(2)
    const call = runMock.mock.calls[0]?.[0]
    expect(call?.prompt).toBe("fix the widget")
    expect(call?.cwd).toBe("/explicit/dir")
    expect(call?.verify).toBe("bun test")
    expect(call?.abort).toBe(ctxSignal)
    const plainCall = runMock.mock.calls[1]?.[0]
    expect(plainCall?.prompt).toBe("plain")
    expect(plainCall?.cwd).toBeUndefined()
    expect(plainCall?.verify).toBeUndefined()
    expect(plainCall?.abort).toBe(ctxSignal)
  })
})
