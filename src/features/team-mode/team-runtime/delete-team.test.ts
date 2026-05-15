/// <reference types="bun-types" />

import { afterEach, describe, expect, mock, test } from "bun:test"
import { rm } from "node:fs/promises"

import { TeamModeConfigSchema, type TeamModeConfig } from "../../../config/schema/team-mode"
import type { TmuxSessionManager } from "../../tmux-subagent/manager"
import { transitionRuntimeState } from "../team-state-store/store"
import { createFixture, updateMemberStatuses } from "./shutdown-test-fixtures"
import { deleteTeam, type DeleteTeamDeps } from "./delete-team"

function withTmuxVisualization(config: TeamModeConfig): TeamModeConfig {
  return TeamModeConfigSchema.parse({ ...config, tmux_visualization: true })
}

function createDeleteDeps() {
  const removeTeamLayoutMock = mock<DeleteTeamDeps["removeTeamLayout"]>(async () => undefined)
  const deps: DeleteTeamDeps = {
    canVisualize: mock(() => true),
    removeTeamLayout: removeTeamLayoutMock,
    log: mock<DeleteTeamDeps["log"]>(() => undefined),
  }
  return { deps, removeTeamLayoutMock }
}

describe("deleteTeam layout removal result", () => {
  const temporaryDirectories: string[] = []

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map(async (directoryPath) => {
      await rm(directoryPath, { recursive: true, force: true })
    }))
  })

  test("#given runtime has no tmux layout #when deleteTeam runs #then removedLayout is false", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    const { deps, removeTeamLayoutMock } = createDeleteDeps()

    // when
    const result = await deleteTeam(
      fixture.teamRunId,
      withTmuxVisualization(fixture.config),
      {} as TmuxSessionManager,
      undefined,
      undefined,
      deps,
    )

    // then
    expect(result.removedLayout).toBe(false)
    expect(removeTeamLayoutMock).not.toHaveBeenCalled()
  })

  test("#given runtime has a tmux layout #when deleteTeam tears it down #then removedLayout is true", async () => {
    // given
    const fixture = await createFixture()
    temporaryDirectories.push(fixture.baseDir)
    await updateMemberStatuses(fixture.teamRunId, fixture.config, {
      "member-a": "shutdown_approved",
      "member-b": "shutdown_approved",
    })
    await transitionRuntimeState(fixture.teamRunId, (runtimeState) => ({
      ...runtimeState,
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        focusWindowId: "@10",
      },
    }), fixture.config)
    const { deps, removeTeamLayoutMock } = createDeleteDeps()

    // when
    const result = await deleteTeam(
      fixture.teamRunId,
      withTmuxVisualization(fixture.config),
      {} as TmuxSessionManager,
      undefined,
      undefined,
      deps,
    )

    // then
    expect(result.removedLayout).toBe(true)
    expect(removeTeamLayoutMock).toHaveBeenCalledTimes(1)
    expect(removeTeamLayoutMock.mock.calls[0]?.[1]).toMatchObject({ targetSessionId: "$caller" })
  })
})
