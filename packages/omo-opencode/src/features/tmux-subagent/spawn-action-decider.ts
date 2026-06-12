import type {
	CapacityConfig,
	PaneAction,
	SpawnDecision,
	TmuxPaneInfo,
	WindowState,
} from "./types"
import { computeAgentAreaWidth } from "./tmux-grid-constants"
import {
	canSplitPane,
	findMinimalEvictions,
	isSplittableAtCount,
} from "./pane-split-availability"
import { findSpawnTarget } from "./spawn-target-finder"
import { findOldestAgentPane, type SessionMapping } from "./oldest-agent-pane"

function getInitialSplitDirection(layout?: string): "-h" | "-v" {
	return layout === "main-horizontal" ? "-v" : "-h"
}

function isStrictMainLayout(layout?: string): boolean {
	return layout === "main-vertical" || layout === "main-horizontal"
}

export function decideSpawnActions(
	state: WindowState,
	sessionId: string,
	description: string,
	config: CapacityConfig,
	sessionMappings: SessionMapping[],
): SpawnDecision {
	if (!state.mainPane) {
		return { canSpawn: false, actions: [], reason: "no main pane found" }
	}

	const agentAreaWidth = computeAgentAreaWidth(state.windowWidth, config)
	const minAgentPaneWidth = config.agentPaneWidth
	const currentCount = state.agentPanes.length
	const strictLayout = isStrictMainLayout(config.layout)
	const initialSplitDirection = getInitialSplitDirection(config.layout)

	if (agentAreaWidth < minAgentPaneWidth && currentCount > 0) {
		return {
			canSpawn: false,
			actions: [],
			reason: `window too small for agent panes: ${state.windowWidth}x${state.windowHeight}`,
		}
	}

	const oldestPane = findOldestAgentPane(state.agentPanes, sessionMappings)
	const oldestMapping = oldestPane
		? sessionMappings.find((m) => m.paneId === oldestPane.paneId) ?? null
		: null

	if (currentCount === 0) {
		const virtualMainPane: TmuxPaneInfo = { ...state.mainPane, width: state.windowWidth }
		if (canSplitPane(virtualMainPane, initialSplitDirection, minAgentPaneWidth)) {
			return {
				canSpawn: true,
				actions: [
					{
						type: "spawn",
						sessionId,
						description,
						targetPaneId: state.mainPane.paneId,
						splitDirection: initialSplitDirection,
					},
				],
			}
		}
		return { canSpawn: false, actions: [], reason: "mainPane too small to split" }
	}

	const canEvaluateSpawnTarget =
		strictLayout ||
		isSplittableAtCount(agentAreaWidth, currentCount, minAgentPaneWidth)

	if (canEvaluateSpawnTarget) {
		const spawnTarget = findSpawnTarget(state, config)
		if (spawnTarget) {
			return {
				canSpawn: true,
				actions: [
					{
						type: "spawn",
						sessionId,
						description,
						targetPaneId: spawnTarget.targetPaneId,
						splitDirection: spawnTarget.splitDirection,
					},
				],
			}
		}
	}

	if (!strictLayout) {
		const minEvictions = findMinimalEvictions(
			agentAreaWidth,
			currentCount,
			minAgentPaneWidth,
		)
		if (minEvictions === 1 && oldestPane) {
			return {
				canSpawn: true,
				actions: [
					{
						type: "close",
						paneId: oldestPane.paneId,
						sessionId: oldestMapping?.sessionId || "",
					},
					{
						type: "spawn",
						sessionId,
						description,
						targetPaneId: state.mainPane.paneId,
						splitDirection: initialSplitDirection,
					},
				],
				reason: "closed 1 pane to make room for split",
			}
		}
	}

	if (oldestPane) {
		return {
			canSpawn: false,
			actions: [],
			reason: "no split target available (defer attach)",
		}
	}

	return { canSpawn: false, actions: [], reason: "no split target available (defer attach)" }
}

export function decideCloseAction(
	state: WindowState,
	sessionId: string,
	sessionMappings: SessionMapping[],
): PaneAction | null {
	const mapping = sessionMappings.find((m) => m.sessionId === sessionId)
	if (!mapping) return null

	const paneExists = state.agentPanes.some((pane) => pane.paneId === mapping.paneId)
	if (!paneExists) return null

	return { type: "close", paneId: mapping.paneId, sessionId }
}
