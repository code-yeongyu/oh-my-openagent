import { describe, expect, mock, test } from "bun:test"
import { sweepStaleTmuxResources } from "./stale-tmux-resource-sweeper"

const noTmuxSweeps = {
	isolation: "inline" as const,
	sweepStaleOmoAgentSessions: mock(async () => 0),
	sweepStaleOmoAttachPanes: mock(async () => 0),
}

describe("sweepStaleTmuxResources", () => {
	test("runs only the tmux arms on the default backend", async () => {
		const report = await sweepStaleTmuxResources({
			...noTmuxSweeps,
			sweepStaleOmoAttachPanes: mock(async () => 2),
			sweepStaleHerdrAgentsWorkspaces: mock(async () => ["omo-agents-1"]),
		})

		expect(report).toEqual({
			killed: 2,
			killedAttachPanes: 2,
			killedIsolatedSessions: 0,
			killedHerdrWorkspaces: 0,
		})
	})

	test("runs the herdr arm only when the multiplexer is herdr", async () => {
		const herdrSweep = mock(async () => ["omo-agents-111", "omo-agents-222"])

		const report = await sweepStaleTmuxResources({
			...noTmuxSweeps,
			multiplexer: "herdr",
			sweepStaleOmoAttachPanes: mock(async () => 1),
			sweepStaleHerdrAgentsWorkspaces: herdrSweep,
		})

		expect(herdrSweep).toHaveBeenCalledTimes(1)
		expect(report).toEqual({
			killed: 3,
			killedAttachPanes: 1,
			killedIsolatedSessions: 0,
			killedHerdrWorkspaces: 2,
		})

		const withoutArm = await sweepStaleTmuxResources({
			...noTmuxSweeps,
			multiplexer: "herdr",
		})
		expect(withoutArm.killedHerdrWorkspaces).toBe(0)
	})

	test("keeps the session arm gated on isolation=session", async () => {
		const report = await sweepStaleTmuxResources({
			isolation: "session",
			sweepStaleOmoAgentSessions: mock(async () => 1),
			sweepStaleOmoAttachPanes: mock(async () => 0),
		})

		expect(report.killedIsolatedSessions).toBe(1)
		expect(report.killed).toBe(1)
	})
})
