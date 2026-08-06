/// <reference types="bun-types" />

import type { RuntimeStateMember } from "../types"
import { log } from "../logger"
import { closeTmuxPane } from "@oh-my-opencode/tmux-core"

type TeamMemberPaneIds = Pick<RuntimeStateMember, "tmuxPaneId" | "tmuxGridPaneId">

export type CloseTeamMemberPaneDeps = {
	readonly closeTmuxPane: (paneId: string) => Promise<boolean>
	readonly log: (message: string, data?: unknown) => void
}

const defaultDeps: CloseTeamMemberPaneDeps = {
	closeTmuxPane,
	log,
}

export async function closeTeamMemberPane(
	member: TeamMemberPaneIds,
	deps: CloseTeamMemberPaneDeps = defaultDeps,
): Promise<boolean> {
	const paneIds = [member.tmuxPaneId, member.tmuxGridPaneId].filter((paneId): paneId is string => paneId !== undefined && paneId.length > 0)
	if (paneIds.length === 0) {
		return false
	}

	const results = await Promise.all(paneIds.map(async (paneId) => {
		try {
			return await deps.closeTmuxPane(paneId)
		} catch (error) {
			deps.log("[closeTeamMemberPane] FAILED", {
				paneId,
				error: error instanceof Error ? error.message : String(error),
			})
			return false
		}
	}))

	return results.some(Boolean)
}
