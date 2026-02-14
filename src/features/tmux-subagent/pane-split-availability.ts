import { MIN_PANE_HEIGHT, MIN_PANE_WIDTH } from "./types"
import type { SplitDirection, TmuxPaneInfo } from "./types"
import {
	DIVIDER_SIZE,
	MAX_COLS,
	MAX_ROWS,
	MIN_SPLIT_HEIGHT,
	MIN_SPLIT_WIDTH,
} from "./tmux-grid-constants"

function minSplitWidthFor(minPaneWidth: number): number {
	return 2 * minPaneWidth + DIVIDER_SIZE
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
	minPaneWidth: number = MIN_PANE_WIDTH,
): boolean {
	const columnWidth = getColumnWidth(agentAreaWidth, paneCount)
	return columnWidth >= minSplitWidthFor(minPaneWidth)
}

export function findMinimalEvictions(
	agentAreaWidth: number,
	currentCount: number,
	minPaneWidth: number = MIN_PANE_WIDTH,
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
	minPaneWidth: number = MIN_PANE_WIDTH,
): boolean {
	if (direction === "-h") {
		return pane.width >= minSplitWidthFor(minPaneWidth)
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
