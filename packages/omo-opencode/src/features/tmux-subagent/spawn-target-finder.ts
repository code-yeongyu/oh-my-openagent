import type { CapacityConfig, SplitDirection, TmuxPaneInfo, WindowState } from "./types"
import { computeMainPaneWidth } from "./tmux-grid-constants"
import { computeGridPlan, mapPaneToSlot } from "./grid-planning"
import { canSplitPane } from "./pane-split-availability"

export interface SpawnTarget {
	targetPaneId: string
	splitDirection: SplitDirection
}

function isStrictMainVertical(config: CapacityConfig): boolean {
	return config.layout === "main-vertical"
}

function isStrictMainHorizontal(config: CapacityConfig): boolean {
	return config.layout === "main-horizontal"
}

function isStrictMainLayout(config: CapacityConfig): boolean {
	return isStrictMainVertical(config) || isStrictMainHorizontal(config)
}

function getInitialSplitDirection(config: CapacityConfig): SplitDirection {
	return isStrictMainHorizontal(config) ? "-v" : "-h"
}

function getStrictFollowupSplitDirection(config: CapacityConfig): SplitDirection {
	return isStrictMainHorizontal(config) ? "-h" : "-v"
}

function sortPanesForStrictLayout(panes: TmuxPaneInfo[], config: CapacityConfig): TmuxPaneInfo[] {
	if (isStrictMainHorizontal(config)) {
		return [...panes].sort((a, b) => a.left - b.left || a.top - b.top)
	}
	return [...panes].sort((a, b) => a.top - b.top || a.left - b.left)
}

function buildOccupancy(
	agentPanes: TmuxPaneInfo[],
	plan: ReturnType<typeof computeGridPlan>,
	mainPaneWidth: number,
): Map<string, TmuxPaneInfo> {
	const occupancy = new Map<string, TmuxPaneInfo>()
	for (const pane of agentPanes) {
		const slot = mapPaneToSlot(pane, plan, mainPaneWidth)
		occupancy.set(`${slot.row}:${slot.col}`, pane)
	}
	return occupancy
}

function findFirstEmptySlot(
	occupancy: Map<string, TmuxPaneInfo>,
	plan: ReturnType<typeof computeGridPlan>,
): { row: number; col: number } {
	for (let row = 0; row < plan.rows; row++) {
		for (let col = 0; col < plan.cols; col++) {
			if (!occupancy.has(`${row}:${col}`)) {
				return { row, col }
			}
		}
	}
	return { row: plan.rows - 1, col: plan.cols - 1 }
}

function findSplittableTarget(
	state: WindowState,
	config: CapacityConfig,
	_preferredDirection?: SplitDirection,
): SpawnTarget | null {
	if (!state.mainPane) return null
	const existingCount = state.agentPanes.length
	const minAgentPaneWidth = config.agentPaneWidth
	const initialDirection = getInitialSplitDirection(config)

	if (existingCount === 0) {
		const virtualMainPane: TmuxPaneInfo = { ...state.mainPane, width: state.windowWidth }
		if (canSplitPane(virtualMainPane, initialDirection, minAgentPaneWidth)) {
			return { targetPaneId: state.mainPane.paneId, splitDirection: initialDirection }
		}
		return null
	}

	if (isStrictMainLayout(config)) {
		const followupDirection = getStrictFollowupSplitDirection(config)
		const panesByPriority = sortPanesForStrictLayout(state.agentPanes, config)
		for (const pane of panesByPriority) {
			if (canSplitPane(pane, followupDirection, minAgentPaneWidth)) {
				return { targetPaneId: pane.paneId, splitDirection: followupDirection }
			}
		}
		return null
	}

	const plan = computeGridPlan(
		state.windowWidth,
		state.windowHeight,
		existingCount + 1,
		config,
	)
	const mainPaneWidth = computeMainPaneWidth(state.windowWidth, config)
	const occupancy = buildOccupancy(state.agentPanes, plan, mainPaneWidth)
	const targetSlot = findFirstEmptySlot(occupancy, plan)

	const leftPane = occupancy.get(`${targetSlot.row}:${targetSlot.col - 1}`)
	if (
		!isStrictMainVertical(config) &&
		leftPane &&
		canSplitPane(leftPane, "-h", minAgentPaneWidth)
	) {
		return { targetPaneId: leftPane.paneId, splitDirection: "-h" }
	}

	const abovePane = occupancy.get(`${targetSlot.row - 1}:${targetSlot.col}`)
	if (abovePane && canSplitPane(abovePane, "-v", minAgentPaneWidth)) {
		return { targetPaneId: abovePane.paneId, splitDirection: "-v" }
	}

	const panesByPosition = [...state.agentPanes].sort(
		(a, b) => a.left - b.left || a.top - b.top,
	)

	for (const pane of panesByPosition) {
		if (canSplitPane(pane, "-v", minAgentPaneWidth)) {
			return { targetPaneId: pane.paneId, splitDirection: "-v" }
		}
	}

	if (isStrictMainVertical(config)) {
		return null
	}

	for (const pane of panesByPosition) {
		if (canSplitPane(pane, "-h", minAgentPaneWidth)) {
			return { targetPaneId: pane.paneId, splitDirection: "-h" }
		}
	}

	return null
}

export function findSpawnTarget(
	state: WindowState,
	config: CapacityConfig,
): SpawnTarget | null {
	return findSplittableTarget(state, config)
}
