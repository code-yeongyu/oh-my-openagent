/// <reference types="bun-types" />

import { describe, expect, test, mock, afterAll } from "bun:test"

const runMock = mock(async () => ({ output: "done", stopReason: "end_turn" }))
const headlessMock = mock(async () => ({ output: "headless done", exitCode: 0 }))

mock.module("./acp-client", () => ({
  runDshAcpAgent: runMock,
}))
mock.module("./headless-runner", () => ({
  runDshHeadless: headlessMock,
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
    args: ["@deepseek-ai/dsh"],
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
    expect(call.args).toEqual(["@deepseek-ai/dsh"])
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
    expect(call.args).toEqual(["@deepseek-ai/dsh", "acp"])
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
})
