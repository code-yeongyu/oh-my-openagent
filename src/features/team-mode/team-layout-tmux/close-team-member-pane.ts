/// <reference types="bun-types" />

import type { RuntimeStateMember } from "../types"

type TeamMemberPaneIds = Pick<RuntimeStateMember, "tmuxPaneId" | "tmuxGridPaneId">

export async function closeTeamMemberPane(member: TeamMemberPaneIds): Promise<boolean> {
	const paneIds = [member.tmuxPaneId, member.tmuxGridPaneId].filter((paneId): paneId is string => paneId !== undefined && paneId.length > 0)
	if (paneIds.length === 0) {
		return false
	}

	const [{ log }, { closeTmuxPane }] = await Promise.all([
		import("../../../shared"),
		import("../../../shared/tmux"),
	])

	const results = await Promise.all(paneIds.map(async (paneId) => {
		try {
			return await closeTmuxPane(paneId)
		} catch (error) {
			log("[closeTeamMemberPane] FAILED", {
				paneId,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}))

	return results.some(Boolean)
}
