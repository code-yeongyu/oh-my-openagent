/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import type { BackgroundManager } from "../../background-agent/manager"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import type { deleteTeam } from "./delete-team"
import {
  cleanupSessionTeamRuns,
  clearSessionTeamRunCleanupRegistry,
  getSessionCreatedTeamRunIds,
  registerTeamRunForSessionCleanup,
} from "./session-cleanup"

describe("session team cleanup", () => {
  afterEach(() => {
    clearSessionTeamRunCleanupRegistry()
    mock.restore()
  })

  test("#given team runs created in this process #when session cleanup runs #then it force deletes them with the tmux visualizer manager", async () => {
    // given
    const config = TeamModeConfigSchema.parse({ enabled: true, tmux_visualization: true })
    const tmuxMgr = { getServerUrl: () => "http://127.0.0.1:4096" } as TmuxSessionManager
    const bgMgr = { cancelTask: mock(async () => true) } as BackgroundManager
    const deleteTeamMock = mock(async () => ({
      removedLayout: true,
      removedWorktrees: [],
    })) as typeof deleteTeam

    registerTeamRunForSessionCleanup("team-run-a")
    registerTeamRunForSessionCleanup("team-run-b")

    // when
    const report = await cleanupSessionTeamRuns({
      config,
      tmuxMgr,
      bgMgr,
      deps: {
        deleteTeam: deleteTeamMock,
        log: mock(() => {}),
      },
    })

    // then
    expect(deleteTeamMock).toHaveBeenCalledTimes(2)
    expect(deleteTeamMock).toHaveBeenNthCalledWith(1, "team-run-a", config, tmuxMgr, bgMgr, { force: true })
    expect(deleteTeamMock).toHaveBeenNthCalledWith(2, "team-run-b", config, tmuxMgr, bgMgr, { force: true })
    expect(report).toEqual({
      cleanedTeamRunIds: ["team-run-a", "team-run-b"],
      removedLayoutTeamRunIds: ["team-run-a", "team-run-b"],
      errors: [],
    })
    expect(getSessionCreatedTeamRunIds()).toEqual([])
  })
})
