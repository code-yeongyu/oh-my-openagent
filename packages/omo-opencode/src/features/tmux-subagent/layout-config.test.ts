import { describe, expect, it } from "bun:test"
import { decideSpawnActions, findSpawnTarget, type SessionMapping } from "./decision-engine"
import type { CapacityConfig, WindowState } from "./types"

function createState(
  windowWidth: number,
  windowHeight: number,
  agentPanes: WindowState["agentPanes"],
): WindowState {
  return {
    windowWidth,
    windowHeight,
    mainPane: {
      paneId: "%0",
      width: Math.floor(windowWidth / 2),
      height: windowHeight,
      left: 0,
      top: 0,
      title: "main",
      isActive: true,
    },
    agentPanes,
  }
}

describe("tmux layout-aware split behavior", () => {
  it("uses -v for first spawn in main-horizontal layout", () => {
    const config: CapacityConfig = {
      layout: "main-horizontal",
      mainPaneSize: 60,
      mainPaneMinWidth: 120,
      agentPaneWidth: 40,
    }
    const state = createState(220, 44, [])

    const decision = decideSpawnActions(state, "ses-1", "agent", config, [])

    expect(decision.canSpawn).toBe(true)
    expect(decision.actions[0]).toMatchObject({
      type: "spawn",
      splitDirection: "-v",
    })
  })

  it("uses -h for first spawn in main-vertical layout", () => {
    const config: CapacityConfig = {
      layout: "main-vertical",
      mainPaneSize: 60,
      mainPaneMinWidth: 120,
      agentPaneWidth: 40,
    }
    const state = createState(220, 44, [])

    const decision = decideSpawnActions(state, "ses-1", "agent", config, [])

    expect(decision.canSpawn).toBe(true)
    expect(decision.actions[0]).toMatchObject({
      type: "spawn",
      splitDirection: "-h",
    })
  })

  it("prefers horizontal split target in main-horizontal layout", () => {
    const config: CapacityConfig = {
      layout: "main-horizontal",
      mainPaneSize: 60,
      mainPaneMinWidth: 120,
      agentPaneWidth: 40,
    }
    const state = createState(260, 60, [
      {
        paneId: "%1",
        width: 120,
        height: 30,
        left: 0,
        top: 30,
        title: "agent",
        isActive: false,
      },
    ])

    const target = findSpawnTarget(state, config)

    expect(target).toEqual({ targetPaneId: "%1", splitDirection: "-h" })
  })

  it("defers when strict main-horizontal cannot split", () => {
    const config: CapacityConfig = {
      layout: "main-horizontal",
      mainPaneSize: 60,
      mainPaneMinWidth: 120,
      agentPaneWidth: 40,
    }
    const state = createState(220, 44, [
      {
        paneId: "%1",
        width: 60,
        height: 44,
        left: 0,
        top: 22,
        title: "old",
        isActive: false,
      },
    ])
    const mappings: SessionMapping[] = [
      { sessionId: "old-ses", paneId: "%1", createdAt: new Date("2024-01-01") },
    ]

    const decision = decideSpawnActions(state, "new-ses", "agent", config, mappings)

    expect(decision.canSpawn).toBe(false)
    expect(decision.actions).toHaveLength(0)
    expect(decision.reason).toContain("defer")
  })

  it("still spawns in narrow main-vertical when vertical split is possible", () => {
    const config: CapacityConfig = {
      layout: "main-vertical",
      mainPaneSize: 60,
      mainPaneMinWidth: 120,
      agentPaneWidth: 40,
    }
    const state = createState(169, 40, [
      {
        paneId: "%1",
        width: 48,
        height: 40,
        left: 121,
        top: 0,
        title: "agent",
        isActive: false,
      },
    ])

    const decision = decideSpawnActions(state, "new-ses", "agent", config, [])

    expect(decision.canSpawn).toBe(true)
    expect(decision.actions).toHaveLength(1)
    expect(decision.actions[0]).toMatchObject({
      type: "spawn",
      targetPaneId: "%1",
      splitDirection: "-v",
    })
  })
})
