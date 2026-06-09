const UUID_V4ISH_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

export const TEAM_SESSION_PATTERN = new RegExp(`^omo-team-(${UUID_V4ISH_PATTERN})$`)

export type TeamSweepDeps = {
	listCandidates: () => Promise<string[]>
	killSession: (name: string) => Promise<void>
	log: (message: string, payload?: unknown) => void
}

async function listTeamSessionsViaTmux(tmuxPath: string): Promise<string[]> {
	const { runTmuxCommand } = await import("../../../shared/tmux")
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
	const { runTmuxCommand } = await import("../../../shared/tmux")
	const result = await runTmuxCommand(tmuxPath, ["kill-session", "-t", sessionName])

	if (!result.success) {
		throw new Error(`Failed to kill tmux session: ${sessionName}`)
	}
}

export async function sweepStaleTeamSessionsWith(
	activeTeamRunIds: ReadonlySet<string>,
	deps: TeamSweepDeps,
): Promise<string[]> {
	const { sweepTmuxSessionsWith } = await import("../../../shared/tmux")

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
	const [{ log }, { getTmuxPath }] = await Promise.all([
		import("../../../shared"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
	])
	const tmuxPath = await getTmuxPath()

	if (!tmuxPath) {
		return []
	}

	return sweepStaleTeamSessionsWith(activeTeamRunIds, {
		listCandidates: () => listTeamSessionsViaTmux(tmuxPath),
		killSession: (sessionName) => killTeamSessionViaTmux(tmuxPath, sessionName),
		log,
	})
}
