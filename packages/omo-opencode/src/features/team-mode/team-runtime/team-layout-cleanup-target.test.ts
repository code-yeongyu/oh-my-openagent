import { describe, expect, test } from "bun:test"

import type { RuntimeState } from "../types"
import { getTeamLayoutCleanupTarget } from "./team-layout-cleanup-target"

function createRuntimeState(overrides: Partial<RuntimeState> = {}): RuntimeState {
  return {
    version: 1,
    teamRunId: "11111111-1111-4111-8111-111111111111",
    teamName: "cleanup-target-test",
    specSource: "project",
    createdAt: 1,
    status: "active",
    members: [],
    shutdownRequests: [],
    bounds: {
      maxMembers: 8,
      maxParallelMembers: 4,
      maxMessagesPerRun: 10_000,
      maxWallClockMinutes: 120,
      maxMemberTurns: 500,
    },
    ...overrides,
  }
}

describe("getTeamLayoutCleanupTarget", () => {
  test("returns undefined when no layout was persisted", () => {
    expect(getTeamLayoutCleanupTarget(createRuntimeState())).toBeUndefined()
  })

  test("unites persisted, focus, and grid pane IDs in stable order without leader panes or duplicates", () => {
    const runtimeState = createRuntimeState({
      tmuxLayout: {
        ownedSession: false,
        targetSessionId: "$caller",
        paneIds: ["%10", "%10"],
      },
      members: [
        {
          name: "lead",
          agentType: "leader",
          tmuxPaneId: "%0",
          tmuxGridPaneId: "%1",
          status: "running",
          pendingInjectedMessageIds: [],
        },
        {
          name: "worker-1",
          agentType: "general-purpose",
          tmuxPaneId: "%10",
          tmuxGridPaneId: "%11",
          status: "running",
          pendingInjectedMessageIds: [],
        },
        {
          name: "worker-2",
          agentType: "general-purpose",
          tmuxPaneId: "%12",
          status: "running",
          pendingInjectedMessageIds: [],
        },
      ],
    })

    expect(getTeamLayoutCleanupTarget(runtimeState)).toEqual({
      ownedSession: false,
      targetSessionId: "$caller",
      paneIds: ["%10", "%11", "%12"],
    })
  })

  test("preserves a layout without pane identifiers when members have none", () => {
    const layout = {
      ownedSession: false,
      targetSessionId: "$caller",
    }
    const runtimeState = createRuntimeState({ tmuxLayout: layout })

    expect(getTeamLayoutCleanupTarget(runtimeState)).toBe(layout)
  })
})
