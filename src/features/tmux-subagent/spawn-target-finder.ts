import type { SplitDirection, TmuxPaneInfo, WindowState } from "./types"
import { MAIN_PANE_RATIO } from "./tmux-grid-constants"
import { computeGridPlan, mapPaneToSlot } from "./grid-planning"
import { canSplitPane, getBestSplitDirection } from "./pane-split-availability"

export interface SpawnTarget {
	targetPaneId: string
	splitDirection: SplitDirection
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
	_preferredDirection?: SplitDirection,
): SpawnTarget | null {
	if (!state.mainPane) return null
	const existingCount = state.agentPanes.length

	if (existingCount === 0) {
		const virtualMainPane: TmuxPaneInfo = { ...state.mainPane, width: state.windowWidth }
		if (canSplitPane(virtualMainPane, "-h")) {
			return { targetPaneId: state.mainPane.paneId, splitDirection: "-h" }
		}
		return null
	}

	const plan = computeGridPlan(state.windowWidth, state.windowHeight, existingCount + 1)
	const mainPaneWidth = Math.floor(state.windowWidth * MAIN_PANE_RATIO)
	const occupancy = buildOccupancy(state.agentPanes, plan, mainPaneWidth)
	const targetSlot = findFirstEmptySlot(occupancy, plan)

	const leftPane = occupancy.get(`${targetSlot.row}:${targetSlot.col - 1}`)
	if (leftPane && canSplitPane(leftPane, "-h")) {
		return { targetPaneId: leftPane.paneId, splitDirection: "-h" }
	}

	const abovePane = occupancy.get(`${targetSlot.row - 1}:${targetSlot.col}`)
	if (abovePane && canSplitPane(abovePane, "-v")) {
		return { targetPaneId: abovePane.paneId, splitDirection: "-v" }
	}

	const splittablePanes = state.agentPanes
		.map((pane) => ({ pane, direction: getBestSplitDirection(pane) }))
		.filter(
			(item): item is { pane: TmuxPaneInfo; direction: SplitDirection } =>
				item.direction !== null,
		)
		.sort((a, b) => b.pane.width * b.pane.height - a.pane.width * a.pane.height)

	const best = splittablePanes[0]
	if (best) {
		return { targetPaneId: best.pane.paneId, splitDirection: best.direction }
	}

	return null
}

export function findSpawnTarget(state: WindowState): SpawnTarget | null {
	return findSplittableTarget(state)
}
