const UUID_V4ISH_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export const TEAM_SESSION_PATTERN = new RegExp(`^omo-team-(${UUID_V4ISH_PATTERN})$`)

export type TeamSweepDeps = {
	listCandidates: () => Promise<string[]>
	killSession: (name: string) => Promise<void>
	log: (message: string, payload?: unknown) => void
}

async function listTeamSessionsViaTmux(tmuxPath: string): Promise<string[]> {
	const { runTmuxCommand } = await import("@oh-my-opencode/tmux-core")
	const result = await runTmuxCommand(tmuxPath, ["list-sessions", "-F", "#{session_name}"])

	if (!result.success) {
		return []
	}

	return result.output
		.split("\n")
		.map((line) => line.trim())
		.filter((sessionName) => sessionName.length > 0)
}

async function killTeamSessionViaTmux(tmuxPath: string, sessionName: string): Promise<void> {
	const { runTmuxCommand } = await import("@oh-my-opencode/tmux-core")
	const result = await runTmuxCommand(tmuxPath, ["kill-session", "-t", sessionName])

	if (!result.success) {
		throw new Error(`Failed to kill tmux session: ${sessionName}`)
	}
}

export async function sweepStaleTeamSessionsWith(
	activeTeamRunIds: ReadonlySet<string>,
	deps: TeamSweepDeps,
): Promise<string[]> {
	const { sweepTmuxSessionsWith } = await import("@oh-my-opencode/tmux-core")

	return sweepTmuxSessionsWith(
		{
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidateSessions: async () => deps.listCandidates(),
			killSession: async (sessionName) => {
				await deps.killSession(sessionName)
				return true
			},
			log: deps.log,
		},
		{
			predicate: (sessionName) => {
				const teamRunId = sessionName.match(TEAM_SESSION_PATTERN)?.[1]
				return teamRunId !== undefined && teamRunId.length > 0 && !activeTeamRunIds.has(teamRunId)
			},
		},
	)
}

export async function sweepStaleTeamSessions(activeTeamRunIds: ReadonlySet<string>): Promise<string[]> {
	const { log } = await import("../logger")
	const tmuxPath = "tmux"

	return sweepStaleTeamSessionsWith(activeTeamRunIds, {
		listCandidates: () => listTeamSessionsViaTmux(tmuxPath),
		killSession: (sessionName) => killTeamSessionViaTmux(tmuxPath, sessionName),
		log,
	})
}

export type HerdrSweepDeps = {
	listWorkspaces: () => Promise<Array<{ workspaceId: string; label: string }>>
	listAgents: () => Promise<Array<{ paneId: string; name?: string; status?: string }>>
	closeWorkspace: (workspaceId: string) => Promise<void>
	log: (message: string, payload?: unknown) => void
}

/**
 * Herdr-side stale sweep: close omo-team workspaces whose teamRunId is no
 * longer active, but only when no live agent remains in them (the workspace
 * may still host a running attach). Best-effort and silent on herdr errors:
 * no herdr dependency is required when herdr is absent.
 */
export async function sweepStaleHerdrTeamWorkspacesWith(
	activeTeamRunIds: ReadonlySet<string>,
	deps: HerdrSweepDeps,
): Promise<string[]> {
	const candidates = await deps.listWorkspaces()
	const removed: string[] = []
	for (const workspace of candidates) {
		const teamRunId = workspace.label.match(TEAM_SESSION_PATTERN)?.[1]
		if (teamRunId === undefined || teamRunId.length === 0) continue
		if (activeTeamRunIds.has(teamRunId)) continue
		try {
			const agents = await deps.listAgents()
			const workspacePrefix = `${workspace.workspaceId}:`
			if (agents.some((agent) => agent.paneId.startsWith(workspacePrefix))) continue
			await deps.closeWorkspace(workspace.workspaceId)
			removed.push(workspace.label)
		} catch (error) {
			deps.log("herdr stale team workspace sweep failed", {
				workspaceId: workspace.workspaceId,
				label: workspace.label,
				error: error instanceof Error ? String(error) : String(error),
			})
		}
	}
	return removed
}

export async function sweepStaleHerdrTeamWorkspaces(activeTeamRunIds: ReadonlySet<string>): Promise<string[]> {
	const { log } = await import("../logger")
	const tmuxCore = await import("@oh-my-opencode/tmux-core")
	try {
		return await sweepStaleHerdrTeamWorkspacesWith(activeTeamRunIds, {
			listWorkspaces: () => tmuxCore.herdrListTeamWorkspaces(tmuxCore.defaultHerdrOpsDeps),
			listAgents: () => tmuxCore.herdrListAgents(tmuxCore.defaultHerdrOpsDeps),
			closeWorkspace: (workspaceId) => tmuxCore.herdrCloseWorkspace(workspaceId, tmuxCore.defaultHerdrOpsDeps).then(() => undefined),
			log,
		})
	} catch (error) {
		log("herdr unavailable, skipping herdr team sweep", {
			error: error instanceof Error ? String(error) : String(error),
		})
		return []
	}
}
