import { beforeEach, describe, expect, spyOn, test } from "bun:test"
import { resetMultiplexerPathCacheForTesting } from "../../tools/interactive-bash/tmux-path-resolver"
import {
  createDisabledMultiplexerRuntime,
  resetResolvedMultiplexerRuntimeForTesting,
  setResolvedMultiplexerRuntime,
} from "../../shared/tmux"
import { analyzePaneContent, getCurrentTmuxSession } from "../tmux"
import * as tmuxPathResolver from "../../tools/interactive-bash/tmux-path-resolver"

describe("openclaw tmux helpers", () => {
  beforeEach(() => {
    resetMultiplexerPathCacheForTesting()
    resetResolvedMultiplexerRuntimeForTesting()
  })

  test("analyzePaneContent recognizes the opencode welcome prompt", () => {
    const content = "opencode\nAsk anything...\nRun /help"
    expect(analyzePaneContent(content).confidence).toBeGreaterThanOrEqual(1)
  })

  test("analyzePaneContent returns zero confidence for empty content", () => {
    expect(analyzePaneContent(null).confidence).toBe(0)
  })

  test("getCurrentTmuxSession does not synthesize a session from TMUX_PANE", async () => {
    const originalTmux = process.env.TMUX
    const originalTmuxPane = process.env.TMUX_PANE
    const getTmuxPathSpy = spyOn(tmuxPathResolver, "getTmuxPath").mockResolvedValue("/usr/bin/tmux")

    try {
      process.env.TMUX = "/tmp/tmux-501/default,1,0"
      process.env.TMUX_PANE = "%42"
      setResolvedMultiplexerRuntime(createDisabledMultiplexerRuntime())

      const sessionName = await getCurrentTmuxSession()

      expect(sessionName).toBeNull()
      expect(getTmuxPathSpy).not.toHaveBeenCalled()
    } finally {
      if (originalTmux === undefined) {
        delete process.env.TMUX
      } else {
        process.env.TMUX = originalTmux
      }

      if (originalTmuxPane === undefined) {
        delete process.env.TMUX_PANE
      } else {
        process.env.TMUX_PANE = originalTmuxPane
      }

      getTmuxPathSpy.mockRestore()
    }
  })
})
