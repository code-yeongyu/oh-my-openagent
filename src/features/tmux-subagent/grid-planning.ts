import type { TmuxPaneInfo } from "./types"
import {
	DIVIDER_SIZE,
	MAIN_PANE_RATIO,
	MAX_GRID_SIZE,
} from "./tmux-grid-constants"
import { MIN_PANE_HEIGHT, MIN_PANE_WIDTH } from "./types"

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

export function calculateCapacity(
	windowWidth: number,
	windowHeight: number,
): GridCapacity {
	const availableWidth = Math.floor(windowWidth * (1 - MAIN_PANE_RATIO))
	const cols = Math.min(
		MAX_GRID_SIZE,
		Math.max(
			0,
			Math.floor(
				(availableWidth + DIVIDER_SIZE) / (MIN_PANE_WIDTH + DIVIDER_SIZE),
			),
		),
	)
	const rows = Math.min(
		MAX_GRID_SIZE,
		Math.max(
			0,
			Math.floor(
				(windowHeight + DIVIDER_SIZE) / (MIN_PANE_HEIGHT + DIVIDER_SIZE),
			),
		),
	)
	return { cols, rows, total: cols * rows }
}

export function computeGridPlan(
	windowWidth: number,
	windowHeight: number,
	paneCount: number,
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
			if (cols * rows < paneCount) continue
			const area = cols * rows
			if (area < bestArea || (area === bestArea && rows < bestRows)) {
				bestCols = cols
				bestRows = rows
				bestArea = area
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
	mainPaneWidth: number,
): GridSlot {
	const rightAreaX = mainPaneWidth
	const relativeX = Math.max(0, pane.left - rightAreaX)
	const relativeY = pane.top

	const col =
		plan.slotWidth > 0
			? Math.min(plan.cols - 1, Math.floor(relativeX / plan.slotWidth))
			: 0
	const row =
		plan.slotHeight > 0
			? Math.min(plan.rows - 1, Math.floor(relativeY / plan.slotHeight))
			: 0

	return { row, col }
}
