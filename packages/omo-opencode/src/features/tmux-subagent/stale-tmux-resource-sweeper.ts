import type { MultiplexerBackend } from "@oh-my-opencode/tmux-core"
import type { TmuxConfig } from "../../config/schema"

export type StaleTmuxResourceSweepReport = {
	readonly killed: number
	readonly killedAttachPanes: number
	readonly killedIsolatedSessions: number
	readonly killedHerdrWorkspaces: number
}

export type StaleTmuxResourceSweepDeps = {
	readonly isolation: TmuxConfig["isolation"]
	readonly multiplexer?: MultiplexerBackend
	readonly sweepStaleOmoAgentSessions: () => Promise<number>
	readonly sweepStaleOmoAttachPanes: () => Promise<number>
	/** Herdr arm: closes omo-agents-<pid> workspaces of dead manager processes. */
	readonly sweepStaleHerdrAgentsWorkspaces?: () => Promise<string[]>
}

export async function sweepStaleTmuxResources(
	deps: StaleTmuxResourceSweepDeps,
): Promise<StaleTmuxResourceSweepReport> {
	const killedIsolatedSessions = deps.isolation === "session"
		? await deps.sweepStaleOmoAgentSessions()
		: 0
	const killedAttachPanes = await deps.sweepStaleOmoAttachPanes()
	const killedHerdrWorkspaces = deps.multiplexer === "herdr" && deps.sweepStaleHerdrAgentsWorkspaces
		? (await deps.sweepStaleHerdrAgentsWorkspaces()).length
		: 0

	return {
		killed: killedIsolatedSessions + killedAttachPanes + killedHerdrWorkspaces,
		killedAttachPanes,
		killedIsolatedSessions,
		killedHerdrWorkspaces,
	}
}
