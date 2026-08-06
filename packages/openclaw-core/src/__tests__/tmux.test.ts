/// <reference path="../../../../bun-test.d.ts" />

import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test"
import * as tmuxModule from "../tmux"

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

beforeEach(() => {
  runTmuxCommandMock.mockReset()
  getTmuxPathMock.mockReset()
  getTmuxPathMock.mockResolvedValue("/mock/tmux")
})

afterAll(() => {
  mock.restore()
})

describe("openclaw tmux helpers", () => {
  const tmuxDeps = {
    getTmuxPath: getTmuxPathMock,
    runTmuxCommand: runTmuxCommandMock,
  }

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
    const result = await tmuxModule.isTmuxAvailableWithDeps(tmuxDeps)

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
    const result = await tmuxModule.getTmuxSessionNameWithDeps(tmuxDeps)

    // then
    expect(result).toBe("team-mode")
    expect(runTmuxCommandMock).toHaveBeenCalledWith("/mock/tmux", ["display-message", "-p", "#S"])
  })

  test("getTmuxSessionName returns null when tmux command lookup throws Error", async () => {
    // given
    runTmuxCommandMock.mockImplementation(async () => {
      throw new Error("tmux unavailable")
    })

    // when
    const result = await tmuxModule.getTmuxSessionNameWithDeps(tmuxDeps)

    // then
    expect(result).toBeNull()
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
    const result = await tmuxModule.captureTmuxPaneWithDeps("%42", 30, tmuxDeps)

    // then
    expect(result).toBe("pane output")
    expect(runTmuxCommandMock).toHaveBeenCalledWith("/mock/tmux", ["capture-pane", "-p", "-t", "%42", "-S", "-30"])
  })

  test("captureTmuxPane rethrows non-Error command failures", async () => {
    // given
    const thrownValue = { reason: "unexpected throw shape" }
    runTmuxCommandMock.mockImplementation(async () => {
      throw thrownValue
    })

    // when
    const result = tmuxModule.captureTmuxPaneWithDeps("%42", 30, tmuxDeps)

    // then
    await result.then(
      () => {
        throw new Error("Expected captureTmuxPane to reject")
      },
      (error: unknown) => {
        expect(error).toBe(thrownValue)
      },
    )
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
    const result = await tmuxModule.sendToPaneWithDeps("%42", "hello", true, tmuxDeps)

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
