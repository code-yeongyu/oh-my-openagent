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
    // given - pane with exactly minimum splittable width (107)
    const pane = createPane(MIN_SPLIT_WIDTH, 20)

    // when
    const result = canSplitPane(pane, "-h")

    // then
    expect(result).toBe(true)
  })

  it("returns false for horizontal split when width < 2*MIN+1", () => {
    // given - pane just below minimum splittable width
    const pane = createPane(MIN_SPLIT_WIDTH - 1, 20)

    // when
    const result = canSplitPane(pane, "-h")

    // then
    expect(result).toBe(false)
  })

  it("returns true for vertical split when height >= 2*MIN+1", () => {
    // given - pane with exactly minimum splittable height (23)
    const pane = createPane(50, MIN_SPLIT_HEIGHT)

    // when
    const result = canSplitPane(pane, "-v")

    // then
    expect(result).toBe(true)
  })

  it("returns false for vertical split when height < 2*MIN+1", () => {
    // given - pane just below minimum splittable height
    const pane = createPane(50, MIN_SPLIT_HEIGHT - 1)

    // when
    const result = canSplitPane(pane, "-v")

    // then
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
    // given
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_HEIGHT - 1)

    // when
    const result = canSplitPaneAnyDirection(pane)

    // then
    expect(result).toBe(true)
  })

  it("returns true when can split vertically but not horizontally", () => {
    // given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT)

    // when
    const result = canSplitPaneAnyDirection(pane)

    // then
    expect(result).toBe(true)
  })

  it("returns false when cannot split in any direction", () => {
    // given - pane too small in both dimensions
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT - 1)

    // when
    const result = canSplitPaneAnyDirection(pane)

    // then
    expect(result).toBe(false)
  })

  it("#given custom minPaneWidth #when pane fits smaller width #then returns true", () => {
    //#given - pane too small for default MIN_PANE_WIDTH(52) but fits custom 30
    const customMin = 30
    const customMinSplitW = 2 * customMin + 1
    const pane = createPane(customMinSplitW, MIN_SPLIT_HEIGHT - 1)

    //#when
    const defaultResult = canSplitPaneAnyDirection(pane)
    const customResult = canSplitPaneAnyDirection(pane, customMin)

    //#then
    expect(defaultResult).toBe(false)
    expect(customResult).toBe(true)
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
    // given
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_HEIGHT - 1)

    // when
    const result = getBestSplitDirection(pane)

    // then
    expect(result).toBe("-h")
  })

  it("returns -v when only vertical split possible", () => {
    // given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT)

    // when
    const result = getBestSplitDirection(pane)

    // then
    expect(result).toBe("-v")
  })

  it("returns null when no split possible", () => {
    // given
    const pane = createPane(MIN_SPLIT_WIDTH - 1, MIN_SPLIT_HEIGHT - 1)

    // when
    const result = getBestSplitDirection(pane)

    // then
    expect(result).toBe(null)
  })

  it("returns -h when width >= height and both splits possible", () => {
    // given - wider than tall
    const pane = createPane(MIN_SPLIT_WIDTH + 10, MIN_SPLIT_HEIGHT)

    // when
    const result = getBestSplitDirection(pane)

    // then
    expect(result).toBe("-h")
  })

  it("returns -v when height > width and both splits possible", () => {
    // given - taller than wide (height needs to be > width for -v)
    const pane = createPane(MIN_SPLIT_WIDTH, MIN_SPLIT_WIDTH + 10)

    // when
    const result = getBestSplitDirection(pane)

    // then
    expect(result).toBe("-v")
  })

  it("#given custom minPaneWidth #when pane width below default but above custom #then returns -h", () => {
    //#given
    const customMin = 30
    const customMinSplitW = 2 * customMin + 1
    const pane = createPane(customMinSplitW, MIN_SPLIT_HEIGHT - 1)

    //#when
    const defaultResult = getBestSplitDirection(pane)
    const customResult = getBestSplitDirection(pane, customMin)

    //#then
    expect(defaultResult).toBe(null)
    expect(customResult).toBe("-h")
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
      // given - window smaller than minimum pane size
      const state = createWindowState(50, 5)

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toContain("too small")
    })

    it("returns canSpawn=true when main pane can be split", () => {
      // given - main pane width >= 2*MIN_PANE_WIDTH+1 = 107
      const state = createWindowState(220, 44)

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })

    it("returns canSpawn=true when 0 agent panes exist and mainPane occupies full window width", () => {
      // given - tmux reports mainPane.width === windowWidth when no splits exist
      // agentAreaWidth = max(0, 252 - 252 - 1) = 0, which is < minPaneWidth
      // but with 0 agent panes, the early return should be skipped
      const windowWidth = 252
      const windowHeight = 56
      const state: WindowState = {
        windowWidth,
        windowHeight,
        mainPane: { paneId: "%0", width: windowWidth, height: windowHeight, left: 0, top: 0, title: "main", isActive: true },
        agentPanes: [],
      }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then - should NOT be blocked by agentAreaWidth check
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })

    it("returns canSpawn=false when 0 agent panes and window genuinely too narrow to split", () => {
      // given - window so narrow that even splitting mainPane wouldn't work
      // canSplitPane requires width >= 2*minPaneWidth + DIVIDER_SIZE = 2*40+1 = 81
      const windowWidth = 70
      const windowHeight = 56
      const state: WindowState = {
        windowWidth,
        windowHeight,
        mainPane: { paneId: "%0", width: windowWidth, height: windowHeight, left: 0, top: 0, title: "main", isActive: true },
        agentPanes: [],
      }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then - should fail because mainPane itself is too small to split
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toContain("too small")
    })

    it("returns canSpawn=false when agent panes exist but agent area too small", () => {
      // given - 1 agent pane exists, but agent area is below minPaneWidth
      // this verifies the early return still works for currentCount > 0
      const state: WindowState = {
        windowWidth: 180,
        windowHeight: 44,
        mainPane: { paneId: "%0", width: 160, height: 44, left: 0, top: 0, title: "main", isActive: true },
        agentPanes: [{ paneId: "%1", width: 19, height: 44, left: 161, top: 0, title: "agent-0", isActive: false }],
      }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then - agent area = max(0, 180-160-1) = 19, which is < agentPaneWidth(40)
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toContain("too small")
    })

    it("spawns at exact minimum splittable width with 0 agent panes", () => {
      // given - canSplitPane requires width >= 2*agentPaneWidth + DIVIDER_SIZE = 2*40+1 = 81
      const exactThreshold = 2 * defaultConfig.agentPaneWidth + 1
      const state: WindowState = {
        windowWidth: exactThreshold,
        windowHeight: 56,
        mainPane: { paneId: "%0", width: exactThreshold, height: 56, left: 0, top: 0, title: "main", isActive: true },
        agentPanes: [],
      }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then - exactly at threshold should succeed
      expect(result.canSpawn).toBe(true)
    })

    it("rejects spawn 1 pixel below minimum splittable width with 0 agent panes", () => {
      // given - 1 below exact threshold
      const belowThreshold = 2 * defaultConfig.agentPaneWidth
      const state: WindowState = {
        windowWidth: belowThreshold,
        windowHeight: 56,
        mainPane: { paneId: "%0", width: belowThreshold, height: 56, left: 0, top: 0, title: "main", isActive: true },
        agentPanes: [],
      }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then - 1 below threshold should fail
      expect(result.canSpawn).toBe(false)
    })

    it("replaces oldest pane when existing panes are too small to split", () => {
      // given - existing pane is below minimum splittable size
      const state = createWindowState(220, 30, [
        { paneId: "%1", width: 50, height: 15, left: 110, top: 0 },
      ])
      const mappings: SessionMapping[] = [
        { sessionId: "old-ses", paneId: "%1", createdAt: new Date("2024-01-01") },
      ]

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, mappings)

      // then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("replace")
    })

    it("can spawn when existing pane is large enough to split", () => {
      // given - existing pane is above minimum splittable size
      const state = createWindowState(320, 50, [
        { paneId: "%1", width: MIN_SPLIT_WIDTH + 10, height: MIN_SPLIT_HEIGHT + 10, left: 160, top: 0 },
      ])

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })
  })

  describe("basic spawn decisions", () => {
    it("returns canSpawn=true when capacity allows new pane", () => {
      // given - 220x44 window, mainPane width=110 >= MIN_SPLIT_WIDTH(107)
      const state = createWindowState(220, 44)

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(true)
      expect(result.actions.length).toBe(1)
      expect(result.actions[0].type).toBe("spawn")
    })

    it("spawns with splitDirection", () => {
      // given
      const state = createWindowState(212, 44, [
        { paneId: "%1", width: MIN_SPLIT_WIDTH, height: MIN_SPLIT_HEIGHT, left: 106, top: 0 },
      ])

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(true)
      expect(result.actions[0].type).toBe("spawn")
      if (result.actions[0].type === "spawn") {
        expect(result.actions[0].sessionId).toBe("ses1")
        expect(result.actions[0].splitDirection).toBeDefined()
      }
    })

    it("returns canSpawn=false when no main pane", () => {
      // given
      const state: WindowState = { windowWidth: 212, windowHeight: 44, mainPane: null, agentPanes: [] }

      // when
      const result = decideSpawnActions(state, "ses1", "test", defaultConfig, [])

      // then
      expect(result.canSpawn).toBe(false)
      expect(result.reason).toBe("no main pane found")
    })
  })
})

describe("calculateCapacity", () => {
  it("calculates 2D grid capacity (cols x rows)", () => {
    // given - 212x44 window (user's actual screen)
    // when
    const capacity = calculateCapacity(212, 44)

    // then - availableWidth=106, cols=(106+1)/(52+1)=2, rows=(44+1)/(11+1)=3 (accounting for dividers)
    expect(capacity.cols).toBe(2)
    expect(capacity.rows).toBe(3)
    expect(capacity.total).toBe(6)
  })

  it("returns 0 cols when agent area too narrow", () => {
    // given - window too narrow for even 1 agent pane
    // when
    const capacity = calculateCapacity(100, 44)

    // then - availableWidth=50, cols=50/53=0
    expect(capacity.cols).toBe(0)
    expect(capacity.total).toBe(0)
  })

  it("returns 0 rows when window too short", () => {
    // given - window too short
    // when
    const capacity = calculateCapacity(212, 10)

    // then - rows=10/11=0
    expect(capacity.rows).toBe(0)
    expect(capacity.total).toBe(0)
  })

  it("scales with larger screens but caps at MAX_GRID_SIZE=4", () => {
    // given - larger 4K-like screen (400x100)
    // when
    const capacity = calculateCapacity(400, 100)

    // then - cols capped at 4, rows capped at 4 (MAX_GRID_SIZE)
    expect(capacity.cols).toBe(3)
    expect(capacity.rows).toBe(4)
    expect(capacity.total).toBe(12)
  })

  it("#given a smaller minPaneWidth #when calculating capacity #then fits more columns", () => {
    //#given
    const smallMinWidth = 30

    //#when
    const defaultCapacity = calculateCapacity(212, 44)
    const customCapacity = calculateCapacity(212, 44, smallMinWidth)

    //#then
    expect(customCapacity.cols).toBeGreaterThanOrEqual(defaultCapacity.cols)
  })

	it("#given non-50 main pane width #when calculating capacity #then uses real agent area width", () => {
		//#given
		const windowWidth = 220
		const windowHeight = 44
		const mainPaneWidth = 132

		//#when
		const capacity = calculateCapacity(windowWidth, windowHeight, 52, mainPaneWidth)

		//#then
		expect(capacity.cols).toBe(1)
		expect(capacity.total).toBe(3)
	})
})

describe("decideSpawnActions with custom agentPaneWidth", () => {
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

  it("#given a smaller agentPaneWidth #when window would be too small for default #then spawns with custom config", () => {
    //#given
    const smallConfig: CapacityConfig = { mainPaneMinWidth: 120, agentPaneWidth: 25 }
    const state = createWindowState(100, 30)

    //#when
    const defaultResult = decideSpawnActions(state, "ses1", "test", { mainPaneMinWidth: 120, agentPaneWidth: 52 }, [])
    const customResult = decideSpawnActions(state, "ses1", "test", smallConfig, [])

    //#then
    expect(defaultResult.canSpawn).toBe(false)
    expect(customResult.canSpawn).toBe(true)
  })

  it("#given custom agentPaneWidth and splittable existing pane #when deciding spawn #then uses spawn without eviction", () => {
    //#given
    const customConfig: CapacityConfig = { mainPaneMinWidth: 120, agentPaneWidth: 40 }
    const state = createWindowState(220, 44, [
      { paneId: "%1", width: 90, height: 30, left: 110, top: 0 },
    ])
    const mappings: SessionMapping[] = [
      { sessionId: "old-ses", paneId: "%1", createdAt: new Date("2024-01-01") },
    ]

    //#when
    const result = decideSpawnActions(state, "ses1", "test", customConfig, mappings)

    //#then
    expect(result.canSpawn).toBe(true)
    expect(result.actions.length).toBe(1)
    expect(result.actions[0].type).toBe("spawn")
    if (result.actions[0].type === "spawn") {
      expect(result.actions[0].targetPaneId).toBe("%1")
      expect(result.actions[0].splitDirection).toBe("-h")
    }
  })

	it("#given wider main pane #when capacity needs two evictions #then replace is chosen", () => {
		//#given
		const config: CapacityConfig = { mainPaneMinWidth: 120, agentPaneWidth: 40 }
		const state = createWindowState(220, 44, [
			{ paneId: "%1", width: 43, height: 44, left: 133, top: 0 },
			{ paneId: "%2", width: 43, height: 44, left: 177, top: 0 },
			{ paneId: "%3", width: 43, height: 21, left: 133, top: 22 },
			{ paneId: "%4", width: 43, height: 21, left: 177, top: 22 },
			{ paneId: "%5", width: 43, height: 21, left: 133, top: 33 },
		])
		state.mainPane = {
			paneId: "%0",
			width: 132,
			height: 44,
			left: 0,
			top: 0,
			title: "main",
			isActive: true,
		}
		const mappings: SessionMapping[] = [
			{ sessionId: "old-1", paneId: "%1", createdAt: new Date("2024-01-01") },
			{ sessionId: "old-2", paneId: "%2", createdAt: new Date("2024-01-02") },
			{ sessionId: "old-3", paneId: "%3", createdAt: new Date("2024-01-03") },
			{ sessionId: "old-4", paneId: "%4", createdAt: new Date("2024-01-04") },
			{ sessionId: "old-5", paneId: "%5", createdAt: new Date("2024-01-05") },
		]

		//#when
		const result = decideSpawnActions(state, "ses-new", "new task", config, mappings)

		//#then
		expect(result.canSpawn).toBe(true)
		expect(result.actions).toHaveLength(1)
		expect(result.actions[0].type).toBe("replace")
	})
})
