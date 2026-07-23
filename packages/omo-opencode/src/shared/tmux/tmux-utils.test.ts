import { describe, expect, test } from "bun:test"

import * as core from "@oh-my-opencode/tmux-core"
import * as adapter from "./tmux-utils"

describe("tmux-utils adapter barrel", () => {
  test("preserves reference identity for direct tmux-core re-exports", () => {
    expect(adapter.isInsideTmux).toBe(core.isInsideTmux)
    expect(adapter.getCurrentPaneId).toBe(core.getCurrentPaneId)
    expect(adapter.isServerRunning).toBe(core.isServerRunning)
    expect(adapter.resetServerCheck).toBe(core.resetServerCheck)
    expect(adapter.buildTmuxAttachCommand).toBe(core.buildTmuxAttachCommand)
    expect(adapter.buildTmuxPlaceholderCommand).toBe(core.buildTmuxPlaceholderCommand)
    expect(adapter.applyLayout).toBe(core.applyLayout)
    expect(adapter.getIsolatedSessionName).toBe(core.getIsolatedSessionName)
    expect(adapter.sweepTmuxSessionsWith).toBe(core.sweepTmuxSessionsWith)
  })

  test("exposes the OpenCode runtime wrappers", () => {
    expect({
      activateTmuxPane: typeof adapter.activateTmuxPane,
      closeTmuxPane: typeof adapter.closeTmuxPane,
      enforceMainPaneWidth: typeof adapter.enforceMainPaneWidth,
      getPaneDimensions: typeof adapter.getPaneDimensions,
      killTmuxSessionIfExists: typeof adapter.killTmuxSessionIfExists,
      replaceTmuxPane: typeof adapter.replaceTmuxPane,
      spawnTmuxPane: typeof adapter.spawnTmuxPane,
      spawnTmuxSession: typeof adapter.spawnTmuxSession,
      spawnTmuxWindow: typeof adapter.spawnTmuxWindow,
      sweepStaleOmoAgentSessions: typeof adapter.sweepStaleOmoAgentSessions,
      sweepStaleOmoAttachPanes: typeof adapter.sweepStaleOmoAttachPanes,
    }).toEqual({
      activateTmuxPane: "function",
      closeTmuxPane: "function",
      enforceMainPaneWidth: "function",
      getPaneDimensions: "function",
      killTmuxSessionIfExists: "function",
      replaceTmuxPane: "function",
      spawnTmuxPane: "function",
      spawnTmuxSession: "function",
      spawnTmuxWindow: "function",
      sweepStaleOmoAgentSessions: "function",
      sweepStaleOmoAttachPanes: "function",
    })
  })
})
