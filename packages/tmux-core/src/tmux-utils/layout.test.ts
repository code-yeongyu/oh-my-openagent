import { afterEach, describe, expect, it, mock } from "bun:test"
import type { TmuxCommandResult } from "../runner"

const spawnCalls: string[][] = []
const spawnMock = mock((args: string[]) => {
  spawnCalls.push(args)
  return { exited: Promise.resolve(0) }
})

const successfulTmuxResult: TmuxCommandResult = {
  success: true,
  output: "",
  stdout: "",
  stderr: "",
  exitCode: 0,
}

describe("applyLayout", () => {
  afterEach(() => {
    spawnCalls.length = 0
    spawnMock.mockClear()
  })

  it("applies main-vertical with main-pane-width option", async () => {
    const { applyLayout } = await import("./layout")

    await applyLayout("tmux", "main-vertical", 60, { spawnCommand: spawnMock })

    expect(spawnCalls).toEqual([
      ["tmux", "select-layout", "main-vertical"],
      ["tmux", "set-window-option", "main-pane-width", "60%"],
    ])
  })

  it("applies main-horizontal with main-pane-height option", async () => {
    const { applyLayout } = await import("./layout")

    await applyLayout("tmux", "main-horizontal", 55, { spawnCommand: spawnMock })

    expect(spawnCalls).toEqual([
      ["tmux", "select-layout", "main-horizontal"],
      ["tmux", "set-window-option", "main-pane-height", "55%"],
    ])
  })

  it("does not set main pane option for non-main layouts", async () => {
    const { applyLayout } = await import("./layout")

    await applyLayout("tmux", "tiled", 50, { spawnCommand: spawnMock })

    expect(spawnCalls).toEqual([["tmux", "select-layout", "tiled"]])
  })
})

describe("enforceMainPaneWidth", () => {
  it("clamps oversized main pane percentages before resizing", async () => {
    const { enforceMainPaneWidth } = await import("./layout")
    const runCalls: Array<[string, string[]]> = []

    await enforceMainPaneWidth("%1", 100, 95, {
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (tmuxPath, args) => {
        runCalls.push([tmuxPath, [...args]])
        return successfulTmuxResult
      },
      log: () => undefined,
    })

    expect(runCalls).toEqual([["tmux", ["resize-pane", "-t", "%1", "-x", "79"]]])
  })

  it("reserves agent pane minimum width when main pane minimum is larger", async () => {
    const { enforceMainPaneWidth } = await import("./layout")
    const runCalls: Array<[string, string[]]> = []

    await enforceMainPaneWidth("%1", 100, {
      mainPaneSize: 50,
      mainPaneMinWidth: 90,
      agentPaneMinWidth: 20,
    }, {
      getTmuxPath: async () => "tmux",
      runTmuxCommand: async (tmuxPath, args) => {
        runCalls.push([tmuxPath, [...args]])
        return successfulTmuxResult
      },
      log: () => undefined,
    })

    expect(runCalls).toEqual([["tmux", ["resize-pane", "-t", "%1", "-x", "79"]]])
  })

  it("skips resizing when tmux path is unavailable", async () => {
    const { enforceMainPaneWidth } = await import("./layout")
    const runCalls: Array<[string, string[]]> = []

    await enforceMainPaneWidth("%1", 100, 50, {
      getTmuxPath: async () => null,
      runTmuxCommand: async (tmuxPath, args) => {
        runCalls.push([tmuxPath, [...args]])
        return successfulTmuxResult
      },
      log: () => undefined,
    })

    expect(runCalls).toEqual([])
  })
})
