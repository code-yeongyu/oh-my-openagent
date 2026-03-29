import { beforeEach, describe, expect, test } from "bun:test"
import { resetMultiplexerPathCacheForTesting } from "../../tools/interactive-bash/tmux-path-resolver"
import { resetResolvedMultiplexerRuntimeForTesting } from "../../shared/tmux"
import { analyzePaneContent, getCurrentTmuxSession } from "../tmux"

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
    const originalDisableTmuxFlag = process.env.OH_MY_OPENCODE_DISABLE_TMUX

    try {
      process.env.TMUX = "/tmp/tmux-501/default,1,0"
      process.env.TMUX_PANE = "%42"
      process.env.OH_MY_OPENCODE_DISABLE_TMUX = "1"

      const sessionName = await getCurrentTmuxSession()

      expect(sessionName).toBeNull()
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

      if (originalDisableTmuxFlag === undefined) {
        delete process.env.OH_MY_OPENCODE_DISABLE_TMUX
      } else {
        process.env.OH_MY_OPENCODE_DISABLE_TMUX = originalDisableTmuxFlag
      }
    }
  })
})
