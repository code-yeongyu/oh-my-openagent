import { MIN_PANE_HEIGHT, MIN_PANE_WIDTH } from "./types"
import type { CapacityConfig } from "./types"

export const MAIN_PANE_RATIO = 0.5
const DEFAULT_MAIN_PANE_SIZE = MAIN_PANE_RATIO * 100
export const MAX_COLS = 2
export const MAX_ROWS = 3
export const MAX_GRID_SIZE = 4
export const DIVIDER_SIZE = 1

export const MIN_SPLIT_WIDTH = 2 * MIN_PANE_WIDTH + DIVIDER_SIZE
export const MIN_SPLIT_HEIGHT = 2 * MIN_PANE_HEIGHT + DIVIDER_SIZE

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

export function getMainPaneSizePercent(config?: CapacityConfig): number {
	return clamp(config?.mainPaneSize ?? DEFAULT_MAIN_PANE_SIZE, 20, 80)
}

export function computeMainPaneWidth(
	windowWidth: number,
	config?: CapacityConfig,
): number {
	const safeWindowWidth = Math.max(0, windowWidth)
	if (!config) {
		return Math.floor(safeWindowWidth * MAIN_PANE_RATIO)
	}

	const dividerWidth = DIVIDER_SIZE
	const minMainPaneWidth = config?.mainPaneMinWidth ?? Math.floor(safeWindowWidth * MAIN_PANE_RATIO)
	const minAgentPaneWidth = config?.agentPaneWidth ?? MIN_PANE_WIDTH
	const percentageMainPaneWidth = Math.floor(
		(safeWindowWidth - dividerWidth) * (getMainPaneSizePercent(config) / 100),
	)
	const maxMainPaneWidth = Math.max(0, safeWindowWidth - dividerWidth - minAgentPaneWidth)

	return clamp(
		Math.max(percentageMainPaneWidth, minMainPaneWidth),
		0,
		maxMainPaneWidth,
	)
}

export function computeAgentAreaWidth(
	windowWidth: number,
	config?: CapacityConfig,
): number {
	const safeWindowWidth = Math.max(0, windowWidth)
	if (!config) {
		return Math.floor(safeWindowWidth * (1 - MAIN_PANE_RATIO))
	}

	const mainPaneWidth = computeMainPaneWidth(safeWindowWidth, config)
	return Math.max(0, safeWindowWidth - DIVIDER_SIZE - mainPaneWidth)
}
