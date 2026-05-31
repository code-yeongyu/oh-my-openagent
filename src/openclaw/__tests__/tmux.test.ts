/// <reference path="../../../bun-test.d.ts" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"

type MockTmuxCommandResult = {
  success: boolean
  output: string
  stdout: string
  stderr: string
  exitCode: number
}

const runTmuxCommandMock = mock(
  async (): Promise<MockTmuxCommandResult> => ({
    success: true,
    output: "",
    stdout: "",
    stderr: "",
    exitCode: 0,
  }),
)

const getTmuxPathMock = mock(async (): Promise<string | null> => "/mock/tmux")

let tmuxModule: typeof import("../tmux")

beforeAll(async () => {
  mock.module("../../shared/tmux/runner", () => ({
    runTmuxCommand: runTmuxCommandMock,
  }))

  mock.module("../../tools/interactive-bash/tmux-path-resolver", () => ({
    getTmuxPath: getTmuxPathMock,
  }))

  tmuxModule = await import("../tmux")
})

beforeEach(() => {
  runTmuxCommandMock.mockReset()
  getTmuxPathMock.mockReset()
  getTmuxPathMock.mockResolvedValue("/mock/tmux")
})

afterAll(() => {
  mock.restore()
})

describe("openclaw tmux helpers", () => {
  test("analyzePaneContent recognizes the opencode welcome prompt", () => {
    // given
    const content = "opencode\nAsk anything...\nRun /help"

    // when
    const result = tmuxModule.analyzePaneContent(content)

    // then
    expect(result.confidence).toBe(1)
  })

  test("analyzePaneContent returns zero confidence for empty content", () => {
    // given
    const content = null

    // when
    const result = tmuxModule.analyzePaneContent(content)

    // then
    expect(result.confidence).toBe(0)
  })

  test("isTmuxAvailable delegates version checks through runTmuxCommand", async () => {
    // given
    runTmuxCommandMock.mockResolvedValue({
      success: true,
      output: "tmux 3.5a",
      stdout: "tmux 3.5a",
      stderr: "",
      exitCode: 0,
    })

    // when
    const result = await tmuxModule.isTmuxAvailable()

    // then
    expect(result).toBe(true)
    expect(getTmuxPathMock).toHaveBeenCalledTimes(1)
    expect(runTmuxCommandMock).toHaveBeenCalledTimes(1)
    expect(runTmuxCommandMock).toHaveBeenCalledWith("/mock/tmux", ["-V"])
  })

  test("getTmuxSessionName delegates session lookup through runTmuxCommand", async () => {
    // given
    runTmuxCommandMock.mockResolvedValue({
      success: true,
      output: "team-mode\n",
      stdout: "team-mode\n",
      stderr: "",
      exitCode: 0,
    })

    // when
    const result = await tmuxModule.getTmuxSessionName()

    // then
    expect(result).toBe("team-mode")
    expect(runTmuxCommandMock).toHaveBeenCalledWith("/mock/tmux", ["display-message", "-p", "#S"])
  })

  test("captureTmuxPane delegates pane capture through runTmuxCommand", async () => {
    // given
    runTmuxCommandMock.mockResolvedValue({
      success: true,
      output: "pane output\n",
      stdout: "pane output\n",
      stderr: "",
      exitCode: 0,
    })

    // when
    const result = await tmuxModule.captureTmuxPane("%42", 30)

    // then
    expect(result).toBe("pane output")
    expect(runTmuxCommandMock).toHaveBeenCalledWith("/mock/tmux", ["capture-pane", "-p", "-t", "%42", "-S", "-30"])
  })

  test("sendToPane delegates literal text and Enter through runTmuxCommand", async () => {
    // given
    runTmuxCommandMock.mockResolvedValue({
      success: true,
      output: "",
      stdout: "",
      stderr: "",
      exitCode: 0,
    })

    // when
    const result = await tmuxModule.sendToPane("%42", "hello", true)

    // then
    expect(result).toBe(true)
    expect(runTmuxCommandMock).toHaveBeenCalledTimes(2)
    expect(runTmuxCommandMock.mock.calls[0]).toEqual([
      "/mock/tmux",
      ["send-keys", "-t", "%42", "-l", "--", "hello"],
    ])
    expect(runTmuxCommandMock.mock.calls[1]).toEqual([
      "/mock/tmux",
      ["send-keys", "-t", "%42", "Enter"],
    ])
  })
})
