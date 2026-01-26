import type { WindowState, PaneAction, SpawnDecision, CapacityConfig, TmuxPaneInfo, SplitDirection } from "./types"
import { MIN_PANE_WIDTH, MIN_PANE_HEIGHT } from "./types"

export interface SessionMapping {
  sessionId: string
  paneId: string
  createdAt: Date
}

export interface GridCapacity {
  cols: number
  rows: number
  total: number
}

export interface GridSlot {
  row: number
  col: number
}

export interface GridPlan {
  cols: number
  rows: number
  slotWidth: number
  slotHeight: number
}

export interface SpawnTarget {
  targetPaneId: string
  splitDirection: SplitDirection
}

const MAIN_PANE_RATIO = 0.5
const MAX_GRID_SIZE = 4
const DIVIDER_SIZE = 1
const MIN_SPLIT_WIDTH = 2 * MIN_PANE_WIDTH + DIVIDER_SIZE
const MIN_SPLIT_HEIGHT = 2 * MIN_PANE_HEIGHT + DIVIDER_SIZE

export function canSplitPane(pane: TmuxPaneInfo, direction: SplitDirection): boolean {
  if (direction === "-h") {
    return pane.width >= MIN_SPLIT_WIDTH
  }
  return pane.height >= MIN_SPLIT_HEIGHT
}

export function canSplitPaneAnyDirection(pane: TmuxPaneInfo): boolean {
  return pane.width >= MIN_SPLIT_WIDTH || pane.height >= MIN_SPLIT_HEIGHT
}

export function getBestSplitDirection(pane: TmuxPaneInfo): SplitDirection | null {
  const canH = pane.width >= MIN_SPLIT_WIDTH
  const canV = pane.height >= MIN_SPLIT_HEIGHT
  
  if (!canH && !canV) return null
  if (canH && !canV) return "-h"
  if (!canH && canV) return "-v"
  return pane.width >= pane.height ? "-h" : "-v"
}

export function calculateCapacity(
  windowWidth: number,
  windowHeight: number
): GridCapacity {
  const availableWidth = Math.floor(windowWidth * (1 - MAIN_PANE_RATIO))
  const cols = Math.min(MAX_GRID_SIZE, Math.max(0, Math.floor((availableWidth + DIVIDER_SIZE) / (MIN_PANE_WIDTH + DIVIDER_SIZE))))
  const rows = Math.min(MAX_GRID_SIZE, Math.max(0, Math.floor((windowHeight + DIVIDER_SIZE) / (MIN_PANE_HEIGHT + DIVIDER_SIZE))))
  const total = cols * rows
  return { cols, rows, total }
}

export function computeGridPlan(
  windowWidth: number,
  windowHeight: number,
  paneCount: number
): GridPlan {
  const capacity = calculateCapacity(windowWidth, windowHeight)
  const { cols: maxCols, rows: maxRows } = capacity
  
  if (maxCols === 0 || maxRows === 0 || paneCount === 0) {
    return { cols: 1, rows: 1, slotWidth: 0, slotHeight: 0 }
  }

  let bestCols = 1
  let bestRows = 1
  let bestArea = Infinity

  for (let rows = 1; rows <= maxRows; rows++) {
    for (let cols = 1; cols <= maxCols; cols++) {
      if (cols * rows >= paneCount) {
        const area = cols * rows
        if (area < bestArea || (area === bestArea && rows < bestRows)) {
          bestCols = cols
          bestRows = rows
          bestArea = area
        }
      }
    }
  }

  const availableWidth = Math.floor(windowWidth * (1 - MAIN_PANE_RATIO))
  const slotWidth = Math.floor(availableWidth / bestCols)
  const slotHeight = Math.floor(windowHeight / bestRows)

  return { cols: bestCols, rows: bestRows, slotWidth, slotHeight }
}

export function mapPaneToSlot(
  pane: TmuxPaneInfo,
  plan: GridPlan,
  mainPaneWidth: number
): GridSlot {
  const rightAreaX = mainPaneWidth
  const relativeX = Math.max(0, pane.left - rightAreaX)
  const relativeY = pane.top

  const col = plan.slotWidth > 0 
    ? Math.min(plan.cols - 1, Math.floor(relativeX / plan.slotWidth))
    : 0
  const row = plan.slotHeight > 0
    ? Math.min(plan.rows - 1, Math.floor(relativeY / plan.slotHeight))
    : 0

  return { row, col }
}

function buildOccupancy(
  agentPanes: TmuxPaneInfo[],
  plan: GridPlan,
  mainPaneWidth: number
): Map<string, TmuxPaneInfo> {
  const occupancy = new Map<string, TmuxPaneInfo>()
  for (const pane of agentPanes) {
    const slot = mapPaneToSlot(pane, plan, mainPaneWidth)
    const key = `${slot.row}:${slot.col}`
    occupancy.set(key, pane)
  }
  return occupancy
}

function findFirstEmptySlot(
  occupancy: Map<string, TmuxPaneInfo>,
  plan: GridPlan
): GridSlot {
  for (let row = 0; row < plan.rows; row++) {
    for (let col = 0; col < plan.cols; col++) {
      const key = `${row}:${col}`
      if (!occupancy.has(key)) {
        return { row, col }
      }
    }
  }
  return { row: plan.rows - 1, col: plan.cols - 1 }
}

function findSplittableTarget(
  state: WindowState,
  preferredDirection?: SplitDirection
): SpawnTarget | null {
  if (!state.mainPane) return null

  const existingCount = state.agentPanes.length

  if (existingCount === 0) {
    const virtualMainPane: TmuxPaneInfo = {
      ...state.mainPane,
      width: state.windowWidth,
    }
    if (canSplitPane(virtualMainPane, "-h")) {
      return { targetPaneId: state.mainPane.paneId, splitDirection: "-h" }
    }
    return null
  }

  const plan = computeGridPlan(state.windowWidth, state.windowHeight, existingCount + 1)
  const mainPaneWidth = Math.floor(state.windowWidth * MAIN_PANE_RATIO)
  const occupancy = buildOccupancy(state.agentPanes, plan, mainPaneWidth)
  const targetSlot = findFirstEmptySlot(occupancy, plan)

  const leftKey = `${targetSlot.row}:${targetSlot.col - 1}`
  const leftPane = occupancy.get(leftKey)
  if (leftPane && canSplitPane(leftPane, "-h")) {
    return { targetPaneId: leftPane.paneId, splitDirection: "-h" }
  }

  const aboveKey = `${targetSlot.row - 1}:${targetSlot.col}`
  const abovePane = occupancy.get(aboveKey)
  if (abovePane && canSplitPane(abovePane, "-v")) {
    return { targetPaneId: abovePane.paneId, splitDirection: "-v" }
  }

  const splittablePanes = state.agentPanes
    .map(p => ({ pane: p, direction: getBestSplitDirection(p) }))
    .filter(({ direction }) => direction !== null)
    .sort((a, b) => (b.pane.width * b.pane.height) - (a.pane.width * a.pane.height))

  if (splittablePanes.length > 0) {
    const best = splittablePanes[0]
    return { targetPaneId: best.pane.paneId, splitDirection: best.direction! }
  }

  return null
}

export function findSpawnTarget(state: WindowState): SpawnTarget | null {
  return findSplittableTarget(state)
}

function findOldestSession(mappings: SessionMapping[]): SessionMapping | null {
  if (mappings.length === 0) return null
  return mappings.reduce((oldest, current) =>
    current.createdAt < oldest.createdAt ? current : oldest
  )
}

function findOldestAgentPane(
  agentPanes: TmuxPaneInfo[],
  sessionMappings: SessionMapping[]
): TmuxPaneInfo | null {
  if (agentPanes.length === 0) return null
  
  const paneIdToAge = new Map<string, Date>()
  for (const mapping of sessionMappings) {
    paneIdToAge.set(mapping.paneId, mapping.createdAt)
  }
  
  const panesWithAge = agentPanes
    .map(p => ({ pane: p, age: paneIdToAge.get(p.paneId) }))
    .filter(({ age }) => age !== undefined)
    .sort((a, b) => a.age!.getTime() - b.age!.getTime())
  
  if (panesWithAge.length > 0) {
    return panesWithAge[0].pane
  }
  
  return agentPanes.reduce((oldest, p) => {
    if (p.top < oldest.top || (p.top === oldest.top && p.left < oldest.left)) {
      return p
    }
    return oldest
  })
}

export function decideSpawnActions(
  state: WindowState,
  sessionId: string,
  description: string,
  _config: CapacityConfig,
  sessionMappings: SessionMapping[]
): SpawnDecision {
  if (!state.mainPane) {
    return { canSpawn: false, actions: [], reason: "no main pane found" }
  }

  const capacity = calculateCapacity(state.windowWidth, state.windowHeight)
  
  if (capacity.total === 0) {
    return {
      canSpawn: false,
      actions: [],
      reason: `window too small for agent panes: ${state.windowWidth}x${state.windowHeight}`,
    }
  }

  let currentState = state
  const closeActions: PaneAction[] = []
  const maxIterations = state.agentPanes.length + 1

  for (let i = 0; i < maxIterations; i++) {
    const spawnTarget = findSplittableTarget(currentState)
    
    if (spawnTarget) {
      return {
        canSpawn: true,
        actions: [
          ...closeActions,
          { 
            type: "spawn", 
            sessionId, 
            description, 
            targetPaneId: spawnTarget.targetPaneId,
            splitDirection: spawnTarget.splitDirection
          }
        ],
        reason: closeActions.length > 0 ? `closed ${closeActions.length} pane(s) to make room` : undefined,
      }
    }

    const oldestPane = findOldestAgentPane(currentState.agentPanes, sessionMappings)
    if (!oldestPane) {
      break
    }

    const mappingForPane = sessionMappings.find(m => m.paneId === oldestPane.paneId)
    closeActions.push({
      type: "close",
      paneId: oldestPane.paneId,
      sessionId: mappingForPane?.sessionId || ""
    })

    currentState = {
      ...currentState,
      agentPanes: currentState.agentPanes.filter(p => p.paneId !== oldestPane.paneId)
    }
  }

  return {
    canSpawn: false,
    actions: [],
    reason: "no splittable pane found even after closing all agent panes",
  }
}

export function decideCloseAction(
  state: WindowState,
  sessionId: string,
  sessionMappings: SessionMapping[]
): PaneAction | null {
  const mapping = sessionMappings.find((m) => m.sessionId === sessionId)
  if (!mapping) return null

  const paneExists = state.agentPanes.some((p) => p.paneId === mapping.paneId)
  if (!paneExists) return null

  return { type: "close", paneId: mapping.paneId, sessionId }
}
