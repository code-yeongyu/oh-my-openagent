import type { TmuxPaneInfo } from "./types"

export interface SessionMapping {
	sessionId: string
	paneId: string
	createdAt: Date
}

export function findOldestAgentPane(
	agentPanes: TmuxPaneInfo[],
	sessionMappings: SessionMapping[],
): TmuxPaneInfo | null {
	if (agentPanes.length === 0) return null

	const paneIdToAge = new Map<string, Date>()
	for (const mapping of sessionMappings) {
		paneIdToAge.set(mapping.paneId, mapping.createdAt)
	}

	const panesWithAge = agentPanes
		.map((pane) => ({ pane, age: paneIdToAge.get(pane.paneId) }))
		.filter(
			(item): item is { pane: TmuxPaneInfo; age: Date } => item.age !== undefined,
		)
		.sort((a, b) => a.age.getTime() - b.age.getTime())

	if (panesWithAge.length > 0) {
		return panesWithAge[0].pane
	}

	return agentPanes.reduce((oldest, pane) => {
		if (pane.top < oldest.top || (pane.top === oldest.top && pane.left < oldest.left)) {
			return pane
		}
		return oldest
	})
}
