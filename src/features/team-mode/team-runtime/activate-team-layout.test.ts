/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"

import { TeamModeConfigSchema } from "../../../config/schema/team-mode"
import * as layoutModule from "../team-layout-tmux/layout"
import * as storeModule from "../team-state-store/store"
import { RuntimeStateSchema, type RuntimeState } from "../types"
import { activateTeamLayout } from "./activate-team-layout"

let createTeamLayoutSpy: ReturnType<typeof spyOn<typeof layoutModule, "createTeamLayout">>
let transitionRuntimeStateSpy: ReturnType<typeof spyOn<typeof storeModule, "transitionRuntimeState">>

function createRuntimeState() {
  return RuntimeStateSchema.parse({
    version: 1,
    teamRunId: crypto.randomUUID(),
    teamName: "alpha-team",
    specSource: "project",
    createdAt: Date.now(),
    status: "creating",
    leadSessionId: "ses-lead",
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
    members: [
      {
        name: "lead",
        sessionId: "ses-lead",
        tmuxPaneId: undefined,
        agentType: "leader",
        status: "running",
        pendingInjectedMessageIds: [],
      },
      {
        name: "member-a",
        sessionId: "ses-member-a",
        tmuxPaneId: undefined,
        agentType: "general-purpose",
        status: "running",
        pendingInjectedMessageIds: [],
      },
    ],
  })
}

function createConfig(tmuxVisualization: boolean) {
  return TeamModeConfigSchema.parse({ enabled: true, tmux_visualization: tmuxVisualization })
}

describe("activateTeamLayout", () => {
  afterEach(() => {
    mock.restore()
  })

  beforeEach(() => {
    createTeamLayoutSpy = spyOn(layoutModule, "createTeamLayout")
    createTeamLayoutSpy.mockResolvedValue(null)
    transitionRuntimeStateSpy = spyOn(storeModule, "transitionRuntimeState")
    transitionRuntimeStateSpy.mockImplementation(async (
      _teamRunId,
      transition,
      _config,
    ): Promise<RuntimeState> => transition(createRuntimeState()))
  })

  test("#given a leader and one member #when activateTeamLayout runs #then it excludes the leader from layout members and only persists panes for non-leaders", async () => {
    // given
    const runtimeState = createRuntimeState()
    createTeamLayoutSpy.mockResolvedValue({
      focusWindowId: "@10",
      gridWindowId: "@11",
      focusPanesByMember: { "member-a": "%11" },
      gridPanesByMember: { "member-a": "%21" },
      targetSessionId: "$caller",
      ownedSession: false,
    })

    // when
    const result = await activateTeamLayout(
      runtimeState,
      createConfig(true),
      "/project",
      { getServerUrl: () => "http://127.0.0.1:12345" } as never,
    )

    // then
    expect(result).toBe(true)
    expect(createTeamLayoutSpy).toHaveBeenCalledTimes(1)
    const createLayoutCall = createTeamLayoutSpy.mock.calls[0]
    expect(createLayoutCall?.[1]).toEqual([
      {
        name: "member-a",
        sessionId: "ses-member-a",
        color: undefined,
        worktreePath: "/project",
      },
    ])
    expect(transitionRuntimeStateSpy).toHaveBeenCalledTimes(1)
    const transitionCall = transitionRuntimeStateSpy.mock.calls[0]
    if (!transitionCall) {
      throw new Error("expected transitionRuntimeState to be called")
    }
    const [teamRunId, transition] = transitionCall
    expect(teamRunId).toBe(runtimeState.teamRunId)
    const nextState = transition(runtimeState)
    expect(nextState.members).toEqual([
      {
        ...runtimeState.members[0],
        tmuxPaneId: undefined,
        tmuxGridPaneId: undefined,
      },
      {
        ...runtimeState.members[1],
        tmuxPaneId: "%11",
        tmuxGridPaneId: "%21",
      },
    ])
    expect(nextState.tmuxLayout).toEqual({
      ownedSession: false,
      targetSessionId: "$caller",
      focusWindowId: "@10",
      gridWindowId: "@11",
    })
  })

  test("#given createTeamLayout returns null #when activateTeamLayout runs #then returns false and no state transition fires", async () => {
    // given
    const runtimeState = createRuntimeState()

    // when
    const result = await activateTeamLayout(
      runtimeState,
      createConfig(true),
      "/project",
      { getServerUrl: () => "http://127.0.0.1:12345" } as never,
    )

    // then
    expect(result).toBe(false)
    expect(transitionRuntimeStateSpy).not.toHaveBeenCalled()
  })

  test("#given config.tmux_visualization is false #when activateTeamLayout runs #then it short-circuits, no state change, returns false", async () => {
    // given
    const runtimeState = createRuntimeState()

    // when
    const result = await activateTeamLayout(
      runtimeState,
      createConfig(false),
      "/project",
      { getServerUrl: () => "http://127.0.0.1:12345" } as never,
    )

    // then
    expect(result).toBe(false)
    expect(createTeamLayoutSpy).not.toHaveBeenCalled()
    expect(transitionRuntimeStateSpy).not.toHaveBeenCalled()
  })
})
