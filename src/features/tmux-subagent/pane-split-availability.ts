import type { SplitDirection, TmuxPaneInfo } from "./types"
import {
	DIVIDER_SIZE,
	MAX_COLS,
	MAX_ROWS,
	MIN_SPLIT_HEIGHT,
} from "./tmux-grid-constants"
import { MIN_PANE_WIDTH } from "./types"

function getMinSplitWidth(minPaneWidth?: number): number {
	const width = Math.max(1, minPaneWidth ?? MIN_PANE_WIDTH)
	return 2 * width + DIVIDER_SIZE
}

export function getColumnCount(paneCount: number): number {
	if (paneCount <= 0) return 1
	return Math.min(MAX_COLS, Math.max(1, Math.ceil(paneCount / MAX_ROWS)))
}

export function getColumnWidth(agentAreaWidth: number, paneCount: number): number {
	const cols = getColumnCount(paneCount)
	const dividersWidth = (cols - 1) * DIVIDER_SIZE
	return Math.floor((agentAreaWidth - dividersWidth) / cols)
}

export function isSplittableAtCount(
	agentAreaWidth: number,
	paneCount: number,
	minPaneWidth?: number,
): boolean {
	const columnWidth = getColumnWidth(agentAreaWidth, paneCount)
	return columnWidth >= getMinSplitWidth(minPaneWidth)
}

export function findMinimalEvictions(
	agentAreaWidth: number,
	currentCount: number,
	minPaneWidth?: number,
): number | null {
	for (let k = 1; k <= currentCount; k++) {
		if (isSplittableAtCount(agentAreaWidth, currentCount - k, minPaneWidth)) {
			return k
		}
	}
	return null
}

export function canSplitPane(
	pane: TmuxPaneInfo,
	direction: SplitDirection,
	minPaneWidth?: number,
): boolean {
	if (direction === "-h") {
		return pane.width >= getMinSplitWidth(minPaneWidth)
	}
	return pane.height >= MIN_SPLIT_HEIGHT
}

export function canSplitPaneAnyDirection(
	pane: TmuxPaneInfo,
	minPaneWidth?: number,
): boolean {
	return pane.width >= getMinSplitWidth(minPaneWidth) || pane.height >= MIN_SPLIT_HEIGHT
}

export function getBestSplitDirection(
	pane: TmuxPaneInfo,
	minPaneWidth?: number,
): SplitDirection | null {
	const canH = pane.width >= getMinSplitWidth(minPaneWidth)
	const canV = pane.height >= MIN_SPLIT_HEIGHT

	if (!canH && !canV) return null
	if (canH && !canV) return "-h"
	if (!canH && canV) return "-v"
	return pane.width >= pane.height ? "-h" : "-v"
}
