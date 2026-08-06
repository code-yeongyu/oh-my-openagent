import { describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "./types"
import { spawnTmuxPane } from "./tmux-utils/pane-spawn"

const enabledTmuxConfig = {
  enabled: true,
  layout: "main-vertical",
  main_pane_size: 60,
  main_pane_min_width: 120,
  agent_pane_min_width: 40,
  isolation: "inline",
} satisfies TmuxConfig

describe("missing-tmux behavior", () => {
  it("#given tmux resolver returns null #when spawning a pane #then it returns failure without running tmux", async () => {
    // given
    const runTmuxCommand = mock(() => {
      throw new Error("tmux runner should not be called")
    })

    // when
    const result = await spawnTmuxPane(
      "session-1",
      "worker",
      enabledTmuxConfig,
      "http://127.0.0.1:4096",
      "/tmp/project",
      "%0",
      "-h",
      {
        log: () => undefined,
        runTmuxCommand,
        isInsideTmux: () => true,
        isServerRunning: async () => true,
        getTmuxPath: async () => null,
      },
    )

    // then
    expect(result).toEqual({ success: false })
    expect(runTmuxCommand).not.toHaveBeenCalled()
  })
})
