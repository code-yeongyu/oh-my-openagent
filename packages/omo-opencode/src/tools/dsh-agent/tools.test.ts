/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll } from "bun:test"

const runMock = mock(async () => ({ output: "done", stopReason: "end_turn" }))

mock.module("./acp-client", () => ({
  runDshAcpAgent: runMock,
}))

afterAll(() => {
  mock.restore()
})

const { createDshAgentTool } = await import("./tools")

function makeCtx(directory = "/workspace/project") {
  return { directory } as Parameters<typeof createDshAgentTool>[0]["ctx"]
}

function makeConfig() {
  return {
    enabled: true,
    command: "npx",
    args: ["@deepseek-ai/dsh", "acp"],
    permission: "reject" as const,
    timeout_ms: 300000,
  }
}

describe("createDshAgentTool", () => {
  test("#given a prompt #when executed #then spawns the configured dsh command and returns the committed output", async () => {
    // given
    runMock.mockClear()
    const tool = createDshAgentTool({ ctx: makeCtx(), config: makeConfig() })
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
    expect(runMock).toHaveBeenCalledTimes(1)
    const call = runMock.mock.calls[0]?.[0] as {
      command: string
      args: string[]
      cwd: string
      prompt: string
      permission: string
      timeoutMs: number
    }
    expect(call.command).toBe("npx")
    expect(call.args).toEqual(["@deepseek-ai/dsh", "acp"])
    expect(call.cwd).toBe("/workspace/project")
    expect(call.prompt).toBe("fix the widget")
    expect(call.permission).toBe("reject")
    expect(result).toHaveProperty("output", "done")
  })

  test("#given an explicit cwd arg #when executed #then the arg wins over the session directory", async () => {
    // given
    runMock.mockClear()
    const tool = createDshAgentTool({ ctx: makeCtx("/session/dir"), config: makeConfig() })
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
    const call = runMock.mock.calls[0]?.[0] as { cwd: string }
    expect(call.cwd).toBe("/explicit/dir")
  })
})
