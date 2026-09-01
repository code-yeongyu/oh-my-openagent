import type { TmuxConfig } from "../../config/schema"

export type StaleTmuxResourceSweepReport = {
	readonly killed: number
	readonly killedAttachPanes: number
	readonly killedIsolatedSessions: number
}

export type StaleTmuxResourceSweepDeps = {
	readonly isolation: TmuxConfig["isolation"]
	readonly sweepStaleOmoAgentSessions: () => Promise<number>
	readonly sweepStaleOmoAttachPanes: () => Promise<number>
}

export async function sweepStaleTmuxResources(
	deps: StaleTmuxResourceSweepDeps,
): Promise<StaleTmuxResourceSweepReport> {
	const killedIsolatedSessions = deps.isolation === "session"
		? await deps.sweepStaleOmoAgentSessions()
		: 0
	const killedAttachPanes = await deps.sweepStaleOmoAttachPanes()

	return {
		killed: killedIsolatedSessions + killedAttachPanes,
		killedAttachPanes,
		killedIsolatedSessions,
	}
}
