import type {
	CapacityConfig,
	PaneAction,
	SpawnDecision,
	TmuxPaneInfo,
	WindowState,
} from "./types"
import { DIVIDER_SIZE } from "./tmux-grid-constants"
import {
	canSplitPane,
	findMinimalEvictions,
	isSplittableAtCount,
} from "./pane-split-availability"
import { findSpawnTarget } from "./spawn-target-finder"
import { findOldestAgentPane, type SessionMapping } from "./oldest-agent-pane"

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

	const minPaneWidth = config.agentPaneWidth
	const agentAreaWidth = Math.max(
		0,
		state.windowWidth - state.mainPane.width - DIVIDER_SIZE,
	)
	const currentCount = state.agentPanes.length

	if (agentAreaWidth < minPaneWidth && currentCount > 0) {
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
		if (canSplitPane(virtualMainPane, "-h", minPaneWidth)) {
			return {
				canSpawn: true,
				actions: [
					{
						type: "spawn",
						sessionId,
						description,
						targetPaneId: state.mainPane.paneId,
						splitDirection: "-h",
					},
				],
			}
		}
		return { canSpawn: false, actions: [], reason: "mainPane too small to split" }
	}

	if (isSplittableAtCount(agentAreaWidth, currentCount, minPaneWidth)) {
		const spawnTarget = findSpawnTarget(state, minPaneWidth)
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

	const minEvictions = findMinimalEvictions(agentAreaWidth, currentCount, minPaneWidth)
	if (minEvictions === 1 && oldestPane) {
		return {
			canSpawn: true,
			actions: [
				{
					type: "replace",
					paneId: oldestPane.paneId,
					oldSessionId: oldestMapping?.sessionId || "",
					newSessionId: sessionId,
					description,
				},
			],
			reason: "replaced oldest pane to avoid split churn",
		}
	}

	if (oldestPane) {
		return {
			canSpawn: true,
			actions: [
				{
					type: "replace",
					paneId: oldestPane.paneId,
					oldSessionId: oldestMapping?.sessionId || "",
					newSessionId: sessionId,
					description,
				},
			],
			reason: "replaced oldest pane (no split possible)",
		}
	}

	return { canSpawn: false, actions: [], reason: "no pane available to replace" }
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
