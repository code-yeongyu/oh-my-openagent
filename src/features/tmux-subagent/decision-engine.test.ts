import { describe, it, expect } from "bun:test"
import { 
  decideSpawnActions, 
  calculateCapacity, 
  canSplitPane, 
  canSplitPaneAnyDirection,
  getBestSplitDirection,
  type SessionMapping 
} from "./decision-engine"
import type { WindowState, CapacityConfig, TmuxPaneInfo } from "./types"
import { MIN_PANE_WIDTH, MIN_PANE_HEIGHT } from "./types"

const MIN_SPLIT_WIDTH = 2 * MIN_PANE_WIDTH + 1
const MIN_SPLIT_HEIGHT = 2 * MIN_PANE_HEIGHT + 1

describe("canSplitPane", () => {
  const createPane = (width: number, height: number): TmuxPaneInfo => ({
    paneId: "%1",
    width,
    height,
    left: 100,
    top: 0,
    title: "test",
    isActive: false,
  })

  it("returns true for horizontal split when width >= 2*MIN+1", () => {
    //#given - pane with exactly minimum splittable width (107)
    const pane = createPane(MIN_SPLIT_WIDTH, 20)

    //#when
    const result = canSplitPane(pane, "-h")

    //#then
    expect(result).toBe(true)
  })

  it("returns false for horizontal split when width < 2*MIN+1", () => {
    //#given - pane just below minimum splittable width
    const pane = createPane(MIN_SPLIT_WIDTH - 1, 20)

    //#when
    const result = canSplitPane(pane, "-h")

    //#then
    expect(result).toBe(false)
  })

  it("returns true for vertical split when height >= 2*MIN+1", () => {
    //#given - pane with exactly minimum splittable height (23)
    const pane = createPane(50, MIN_SPLIT_HEIGHT)

    //#when
    const result = canSplitPane(pane, "-v")

    //#then
    expect(result).toBe(true)
  })

  it("returns false for vertical split when height < 2*MIN+1", () => {
    //#given - pane just below minimum splittable height
    const pane = createPane(50, MIN_SPLIT_HEIGHT - 1)

    //#when
    const result = canSplitPane(pane, "-v")

    //#then
    expect(result).toBe(false)
  })
})

describe("canSplitPaneAnyDirection", () => {
  const createPane = (width: number, height: number): TmuxPaneInfo => ({
    paneId: "%1",
    width,
    height,
    left: 100,
    top: 0,
    title: "test",
    isActive: false,
  })

  it("returns true when can split horizontally but not vertically", () => {
    //#given
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_HEIGHT - 1)

    //#when
    const result = canSplitPaneAnyDirection(pane)

    //#then
    expect(result).toBe(true)
  })

  it("returns true when can split vertically but not horizontally", () => {
    //#given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT)

    //#when
    const result = canSplitPaneAnyDirection(pane)

    //#then
    expect(result).toBe(true)
  })

  it("returns false when cannot split in any direction", () => {
    //#given - pane too small in both dimensions
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT - 1)

    //#when
    const result = canSplitPaneAnyDirection(pane)

    //#then
    expect(result).toBe(false)
  })
})

describe("getBestSplitDirection", () => {
  const createPane = (width: number, height: number): TmuxPaneInfo => ({
    paneId: "%1",
    width,
    height,
    left: 100,
    top: 0,
    title: "test",
    isActive: false,
  })

  it("returns -h when only horizontal split possible", () => {
    //#given
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_HEIGHT - 1)

    //#when
    const result = getBestSplitDirection(pane)

    //#then
    expect(result).toBe("-h")
  })

  it("returns -v when only vertical split possible", () => {
    //#given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT)

    //#when
    const result = getBestSplitDirection(pane)

    //#then
    expect(result).toBe("-v")
  })

  it("returns null when no split possible", () => {
    //#given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT - 1)

    //#when
    const result = getBestSplitDirection(pane)

    //#then
    expect(result).toBe(null)
  })

  it("returns -h when width >= height and both splits possible", () => {
    //#given - wider than tall
    const pane = createPane(MIN_SPLIT_WIDTH + 10, MIN_SPLIT_HEIGHT)

    //#when
    const result = getBestSplitDirection(pane)

    //#then
    expect(result).toBe("-h")
  })

  it("returns -v when height > width and both splits possible", () => {
    //#given - taller than wide (height needs to be > width for -v)
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_WIDTH + 10)

    //#when
    const result = getBestSplitDirection(pane)

    //#then
    expect(result).toBe("-v")
  })
})

describe("decideSpawnActions", () => {
  const defaultConfig: CapacityConfig = {
    mainPaneMinWidth: 120,
    agentPaneWidth: 40,
  }

  const createWindowState = (
    windowWidth: number,
    windowHeight: number,
    agentPanes: Array<{ paneId: string; width: number; height: number; left: number; top: number }> = []
  ): WindowState => ({
    windowWidth,
    windowHeight,
    mainPane: { paneId: "%0", width: Math.floor(windowWidth / 2), height: windowHeight, left: 0, top: 0, title: "main", isActive: true },
    agentPanes: agentPanes.map((p, i) => ({
      ...p,
      title: `agent-${i}`,
      isActive: false,
    })),
  })

  describe("minimum size enforcement", () => {
    it("returns canSpawn=false when window too small", () => {
      //#given - window smaller than minimum pane size
      const state = createWindowState(50, 5)

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toContain("too small")
    })

    it("returns canSpawn=true when main pane can be split", () => {
      //#given - main pane width >= 2*MIN_PANE_WIDTH+1 = 107
      const state = createWindowState(220, 44)

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })

    it("closes oldest pane when existing panes are too small to split", () => {
      //#given - existing pane is below minimum splittable size
      const state = createWindowState(220, 30, [
        { paneId: "%1", width: 50, height: 15, left: 110, top: 0 },
      ])
      const mappings: SessionMapping[] = [
        { sessionId: "old-ses", paneId: "%1", createdAt: new Date("2024-01-01") },
      ]

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, mappings)

      //#then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(2)
      expect(result.actions[0].type).toBe("close")
      expect(result.actions[1].type).toBe("spawn")
    })

    it("can spawn when existing pane is large enough to split", () => {
      //#given - existing pane is above minimum splittable size
      const state = createWindowState(320, 50, [
        { paneId: "%1", width: MIN_SPLIT_WIDTH + 10, height: MIN_SPLIT_HEIGHT + 10, left: 160, top: 0 },
      ])

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })
  })

  describe("basic spawn decisions", () => {
    it("returns canSpawn=true when capacity allows new pane", () => {
      //#given - 220x44 window, mainPane width=110 >= MIN_SPLIT_WIDTH(107)
      const state = createWindowState(220, 44)

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })

    it("spawns with splitDirection", () => {
      //#given
      const state = createWindowState(212, 44, [
        { paneId: "%1", width: MIN_SPLIT_WIDTH, height: MIN_SPLIT_HEIGHT, left: 106, top: 0 },
      ])

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(true)
      expect(result.actions[0].type).toBe("spawn")
      if (result.actions[0].type === "spawn") {
        expect(result.actions[0].sessionId).toBe("ses1")
        expect(result.actions[0].splitDirection).toBeDefined()
      }
    })

    it("returns canSpawn=false when no main pane", () => {
      //#given
      const state: WindowState = { windowWidth: 212, windowHeight: 44, mainPane: null, agentPanes: [] }

      //#when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      //#then
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toBe("no main pane found")
    })
  })
})

describe("calculateCapacity", () => {
  it("calculates 2D grid capacity (cols x rows)", () => {
    //#given - 212x44 window (user's actual screen)
    //#when
    const capacity = calculateCapacity(212, 44)

    //#then - availableWidth=106, cols=(106+1)/(52+1)=2, rows=(44+1)/(11+1)=3 (accounting for dividers)
    expect(capacity.cols).toBe(2)
    expect(capacity.rows).toBe(3)
    expect(capacity.total).toBe(6)
  })

  it("returns 0 cols when agent area too narrow", () => {
    //#given - window too narrow for even 1 agent pane
    //#when
    const capacity = calculateCapacity(100, 44)

    //#then - availableWidth=50, cols=50/53=0
    expect(capacity.cols).toBe(0)
    expect(capacity.total).toBe(0)
  })

  it("returns 0 rows when window too short", () => {
    //#given - window too short
    //#when
    const capacity = calculateCapacity(212, 10)

    //#then - rows=10/11=0
    expect(capacity.rows).toBe(0)
    expect(capacity.total).toBe(0)
  })

  it("scales with larger screens but caps at MAX_GRID_SIZE=4", () => {
    //#given - larger 4K-like screen (400x100)
    //#when
    const capacity = calculateCapacity(400, 100)

    //#then - cols capped at 4, rows capped at 4 (MAX_GRID_SIZE)
    expect(capacity.cols).toBe(3)
    expect(capacity.rows).toBe(4)
    expect(capacity.total).toBe(12)
  })
})
