/// <reference types="bun-types" />

import { describe, expect, it, mock } from "bun:test"

import {
	sweepStaleTeamSessionsWith,
	type TeamSweepDeps,
} from "./sweep-stale-team-sessions"

type LoggedMessage = {
	message: string
	meta?: unknown
}

type SweepFixture = {
	deps: TeamSweepDeps
	killedSessionNames: string[]
	loggedMessages: LoggedMessage[]
	killSessionMock: ReturnType<typeof mock>
	listCandidatesMock: ReturnType<typeof mock>
}

function createFixture(candidateSessions: string[]): SweepFixture {
	const killedSessionNames: string[] = []
	const loggedMessages: LoggedMessage[] = []

	const listCandidatesMock = mock(async (): Promise<string[]> => [...candidateSessions])
	const killSessionMock = mock(async (sessionName: string): Promise<void> => {
		killedSessionNames.push(sessionName)
	})

	const deps: TeamSweepDeps = {
		listCandidates: listCandidatesMock,
		killSession: killSessionMock,
		log: (message, meta) => {
			loggedMessages.push({ message, meta })
		},
	}

	return {
		deps,
		killedSessionNames,
		loggedMessages,
		killSessionMock,
		listCandidatesMock,
	}
}

describe("sweepStaleTeamSessionsWith", () => {
	it("#given candidates with mix of active and stale #when sweep #then kills only sessions whose runId is not in active set", async () => {
		// given
		const fixture = createFixture([
			"omo-team-11111111-1111-1111-1111-111111111111",
			"omo-team-22222222-2222-2222-2222-222222222222",
			"omo-team-33333333-3333-3333-3333-333333333333",
			"main",
			"omo-agents-123",
		])
		const activeTeamRunIds = new Set(["11111111-1111-1111-1111-111111111111"])

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(2)
		expect(fixture.killedSessionNames).toEqual([
			"omo-team-22222222-2222-2222-2222-222222222222",
			"omo-team-33333333-3333-3333-3333-333333333333",
		])
		expect(result).toEqual([
			"omo-team-22222222-2222-2222-2222-222222222222",
			"omo-team-33333333-3333-3333-3333-333333333333",
		])
	})

	it("#given all candidates active #when sweep #then kills none", async () => {
		// given
		const fixture = createFixture([
			"omo-team-11111111-1111-1111-1111-111111111111",
			"omo-team-22222222-2222-2222-2222-222222222222",
		])
		const activeTeamRunIds = new Set([
			"11111111-1111-1111-1111-111111111111",
			"22222222-2222-2222-2222-222222222222",
		])

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(0)
		expect(result).toEqual([])
	})

	it("#given listCandidates throws #when sweep #then returns empty array and logs", async () => {
		// given
		const fixture = createFixture([])
		const activeTeamRunIds = new Set<string>()
		fixture.listCandidatesMock.mockImplementation(async (): Promise<string[]> => {
			throw new Error("list failed")
		})

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(result).toEqual([])
		expect(fixture.loggedMessages).toHaveLength(1)
		expect(fixture.loggedMessages[0]?.message).toContain("failed to list")
	})

	it("#given killSession throws for one #when sweep #then continues and returns only successful kills", async () => {
		// given
		const fixture = createFixture([
			"omo-team-11111111-1111-1111-1111-111111111111",
			"omo-team-22222222-2222-2222-2222-222222222222",
			"omo-team-33333333-3333-3333-3333-333333333333",
		])
		const activeTeamRunIds = new Set<string>()
		fixture.killSessionMock.mockImplementation(async (sessionName: string): Promise<void> => {
			if (sessionName === "omo-team-22222222-2222-2222-2222-222222222222") {
				throw new Error("kill failed")
			}

			fixture.killedSessionNames.push(sessionName)
		})

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(3)
		expect(fixture.killedSessionNames).toEqual([
			"omo-team-11111111-1111-1111-1111-111111111111",
			"omo-team-33333333-3333-3333-3333-333333333333",
		])
		expect(fixture.loggedMessages).toHaveLength(1)
		expect(result).toEqual([
			"omo-team-11111111-1111-1111-1111-111111111111",
			"omo-team-33333333-3333-3333-3333-333333333333",
		])
	})

	it("#given candidate name is 'omo-team-' with empty suffix #when sweep #then skipped", async () => {
		// given
		const fixture = createFixture(["omo-team-", "omo-team-11111111-1111-1111-1111-111111111111"])
		const activeTeamRunIds = new Set<string>()

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(fixture.killedSessionNames).toEqual(["omo-team-11111111-1111-1111-1111-111111111111"])
		expect(result).toEqual(["omo-team-11111111-1111-1111-1111-111111111111"])
	})

	it("#given new caller-session topology rolled out with no omo-team-<uuid> candidates #when sweep runs #then the result is empty and killSession is never called", async () => {
		// given
		const fixture = createFixture(["main", "dev-shell", "project-grid"])
		const activeTeamRunIds = new Set<string>(["still-active-run"])

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(result).toEqual([])
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(0)
	})

	it("#given a user tmux session named like a project hash #when sweep runs #then it is preserved because only UUID-backed team sessions are eligible", async () => {
		// given
		const fixture = createFixture(["main", "omo-team-de2e", "dev-shell"])
		const activeTeamRunIds = new Set<string>()

		// when
		const result = await sweepStaleTeamSessionsWith(activeTeamRunIds, fixture.deps)

		// then
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(0)
		expect(fixture.killedSessionNames).toEqual([])
		expect(result).toEqual([])
	})
})
