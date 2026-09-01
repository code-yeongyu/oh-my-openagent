import { afterEach, describe, expect, it, mock } from "bun:test"

const spawnCalls: string[][] = []
const spawnMock = mock((args: string[]) => {
  spawnCalls.push(args)
  return { exited: Promise.resolve(0) }
})

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
