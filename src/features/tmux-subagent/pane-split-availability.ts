import type { SplitDirection, TmuxPaneInfo } from "./types"
import {
	DIVIDER_SIZE,
	MAX_COLS,
	MAX_ROWS,
	MIN_SPLIT_HEIGHT,
	MIN_SPLIT_WIDTH,
} from "./tmux-grid-constants"

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
): boolean {
	const columnWidth = getColumnWidth(agentAreaWidth, paneCount)
	return columnWidth >= MIN_SPLIT_WIDTH
}

export function findMinimalEvictions(
	agentAreaWidth: number,
	currentCount: number,
): number | null {
	for (let k = 1; k <= currentCount; k++) {
		if (isSplittableAtCount(agentAreaWidth, currentCount - k)) {
			return k
		}
	}
	return null
}

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
