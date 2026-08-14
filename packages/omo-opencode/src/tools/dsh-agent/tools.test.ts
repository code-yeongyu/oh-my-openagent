/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll } from "bun:test"

const runMock = mock(async () => ({ output: "done", stopReason: "end_turn" }))
const headlessMock = mock(async () => ({ output: "headless done", exitCode: 0 }))
const verifyMock = mock(async () => ({ verified: true, evidence: "3 pass" }))

mock.module("./acp-client", () => ({
  runDshAcpAgent: runMock,
}))
mock.module("./headless-runner", () => ({
  runDshHeadless: headlessMock,
}))
mock.module("./verify", () => ({
  runVerificationGate: verifyMock,
}))

afterAll(() => {
  mock.restore()
})

const { createDshAgentTool } = await import("./tools")

function makeCtx(directory = "/workspace/project") {
  return { directory } as Parameters<typeof createDshAgentTool>[0]["ctx"]
}

function makeConfig(mode: "headless" | "acp" = "headless") {
  return {
    enabled: true,
    mode,
    command: "npx",
    args: ["-y", "@deepseek-ai/dsh"],
    permission: "reject" as const,
    timeout_ms: 300000,
  }
}

describe("createDshAgentTool", () => {
  test("#given a prompt and headless mode #when executed #then runs the headless profile and returns its output", async () => {
    // given
    headlessMock.mockClear()
    const tool = createDshAgentTool({ ctx: makeCtx(), config: makeConfig("headless") })
    const context = {
      sessionID: "ses_1",
      messageID: "msg_1",
      agent: "sisyphus",
      directory: "/workspace/project",
      worktree: "/workspace/project",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    // when
    const result = await tool.execute({ prompt: "fix the widget" }, context)

    // then
    expect(headlessMock).toHaveBeenCalledTimes(1)
    const call = headlessMock.mock.calls[0]?.[0] as {
      command: string
      args: string[]
      cwd: string
      prompt: string
      timeoutMs: number
    }
    expect(call.command).toBe("npx")
    expect(call.args).toEqual(["-y", "@deepseek-ai/dsh"])
    expect(call.cwd).toBe("/workspace/project")
    expect(call.prompt).toBe("fix the widget")
    expect(result).toHaveProperty("output", "headless done")
  })

  test("#given a prompt and acp mode #when executed #then runs the ACP client with the acp subcommand", async () => {
    // given
    runMock.mockClear()
    const tool = createDshAgentTool({ ctx: makeCtx(), config: makeConfig("acp") })
    const context = {
      sessionID: "ses_1b",
      messageID: "msg_1b",
      agent: "sisyphus",
      directory: "/workspace/project",
      worktree: "/workspace/project",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    // when
    await tool.execute({ prompt: "fix the widget" }, context)

    // then
    const call = runMock.mock.calls[0]?.[0] as { args: string[]; permission: string }
    expect(call.args).toEqual(["-y", "@deepseek-ai/dsh", "acp"])
    expect(call.permission).toBe("reject")
  })

  test("#given an explicit cwd arg #when executed #then the arg wins over the session directory", async () => {
    // given
    headlessMock.mockClear()
    const tool = createDshAgentTool({ ctx: makeCtx("/session/dir"), config: makeConfig("headless") })
    const context = {
      sessionID: "ses_2",
      messageID: "msg_2",
      agent: "sisyphus",
      directory: "/session/dir",
      worktree: "/session/dir",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    // when
    await tool.execute({ prompt: "task", cwd: "/explicit/dir" }, context)

    // then
    const call = headlessMock.mock.calls[0]?.[0] as { cwd: string }
    expect(call.cwd).toBe("/explicit/dir")
  })

  test("#given a verify gate that passes #when executed #then returns the verified result with the gate metadata", async () => {
    // given
    headlessMock.mockClear()
    verifyMock.mockClear()
    verifyMock.mockResolvedValueOnce({ verified: true, evidence: "3 pass" })
    const tool = createDshAgentTool({ ctx: makeCtx(), config: makeConfig("headless") })
    const context = {
      sessionID: "ses_3",
      messageID: "msg_3",
      agent: "sisyphus",
      directory: "/workspace/project",
      worktree: "/workspace/project",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    // when
    const result = await tool.execute({ prompt: "task", verify: "bun test" }, context)

    // then
    expect(verifyMock).toHaveBeenCalledTimes(1)
    const gateCall = verifyMock.mock.calls[0]?.[0] as { command: string; cwd: string }
    expect(gateCall.command).toBe("bun test")
    expect(gateCall.cwd).toBe("/workspace/project")
    expect(result).toMatchObject({
      title: "dsh agent (verified)",
      output: "headless done",
      metadata: { verified: true, verify: "bun test" },
    })
  })

  test("#given a verify gate that fails #when executed #then returns the result with verification evidence appended", async () => {
    // given
    verifyMock.mockClear()
    verifyMock.mockResolvedValueOnce({ verified: false, evidence: "1 fail" })
    const tool = createDshAgentTool({ ctx: makeCtx(), config: makeConfig("headless") })
    const context = {
      sessionID: "ses_4",
      messageID: "msg_4",
      agent: "sisyphus",
      directory: "/workspace/project",
      worktree: "/workspace/project",
      abort: new AbortController().signal,
      metadata: () => {},
      ask: async () => {},
    }

    // when
    const result = await tool.execute({ prompt: "task", verify: "bun test" }, context)

    // then
    expect(result).toMatchObject({ title: "dsh agent (VERIFICATION FAILED)" })
    expect(String(result.output)).toContain("VERIFICATION FAILED")
    expect(String(result.output)).toContain("1 fail")
  })
})
