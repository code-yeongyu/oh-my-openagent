import { beforeEach, describe, expect, it, mock } from "bun:test"
import {
	sweepStaleOmoAgentSessionsWith,
	sweepTmuxSessionsWith,
	type SweepDeps,
} from "./stale-session-sweep"
import { sweepStaleOmoAttachPanesWith, type SweepAttachPaneDeps } from "./stale-attach-pane-sweep"

type SweepFixture = {
	deps: SweepDeps
	candidates: string[]
	killed: string[]
	killSessionMock: ReturnType<typeof mock>
	setCandidates: (sessions: string[]) => void
	setAlive: (predicate: (pid: number) => boolean) => void
}

function createFixture(): SweepFixture {
	const candidates: string[] = []
	const killed: string[] = []
	let aliveCheck: (pid: number) => boolean = () => false

	const killSessionMock = mock(async (sessionName: string): Promise<boolean> => {
		killed.push(sessionName)
		return true
	})

	const deps: SweepDeps = {
		isInsideTmux: () => true,
		getTmuxPath: async () => "tmux",
		listCandidateSessions: async () => [...candidates],
		killSession: killSessionMock,
		processAlive: (pid) => aliveCheck(pid),
		currentPid: 12345,
		log: () => undefined,
	}

	return {
		deps,
		candidates,
		killed,
		killSessionMock,
		setCandidates: (sessions) => {
			candidates.length = 0
			candidates.push(...sessions)
		},
		setAlive: (predicate) => {
			aliveCheck = predicate
		},
	}
}

describe("sweepStaleOmoAgentSessionsWith", () => {
	let fixture: SweepFixture

	beforeEach(() => {
		fixture = createFixture()
	})

	it("#given not inside tmux #when sweep called #then returns 0 without listing", async () => {
		// given
		const deps: SweepDeps = { ...fixture.deps, isInsideTmux: () => false }

		// when
		const result = await sweepStaleOmoAgentSessionsWith(deps)

		// then
		expect(result).toBe(0)
	})

	it("#given tmux not found #when sweep called #then returns 0 without listing", async () => {
		// given
		const deps: SweepDeps = { ...fixture.deps, getTmuxPath: async () => undefined }

		// when
		const result = await sweepStaleOmoAgentSessionsWith(deps)

		// then
		expect(result).toBe(0)
	})

	it("#given candidate list is empty #when sweep called #then returns 0 and does not kill anything", async () => {
		// given
		fixture.setCandidates([])

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(0)
		expect(fixture.killed).toEqual([])
	})

	it("#given sessions with dead PIDs #when sweep called #then each dead session is killed once", async () => {
		// given
		fixture.setCandidates(["omo-agents-99991", "omo-agents-99992"])
		fixture.setAlive(() => false)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(2)
		expect(fixture.killed).toEqual(["omo-agents-99991", "omo-agents-99992"])
	})

	it("#given suffixed sessions with dead PIDs #when sweep called #then they are also killed", async () => {
		// given
		fixture.setCandidates(["omo-agents-99991-1", "omo-agents-99992-abc123"])
		fixture.setAlive(() => false)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(2)
		expect(fixture.killed).toEqual(["omo-agents-99991-1", "omo-agents-99992-abc123"])
	})

	it("#given session matches current PID #when sweep called #then it is NOT killed", async () => {
		// given
		fixture.setCandidates([`omo-agents-${fixture.deps.currentPid}`, "omo-agents-99999"])
		fixture.setAlive(() => false)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(1)
		expect(fixture.killed).toEqual(["omo-agents-99999"])
	})

	it("#given session PID is still alive #when sweep called #then it is NOT killed", async () => {
		// given
		fixture.setCandidates(["omo-agents-88888"])
		fixture.setAlive((pid) => pid === 88888)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(0)
		expect(fixture.killed).toEqual([])
	})

	it("#given killSession returns false #when sweep called #then session is not counted toward killedCount", async () => {
		// given
		fixture.setCandidates(["omo-agents-55555"])
		fixture.setAlive(() => false)
		fixture.killSessionMock.mockImplementation(async () => false)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(0)
		expect(fixture.killSessionMock).toHaveBeenCalledTimes(1)
	})

	it("#given non-matching sessions mixed in #when sweep called #then only supported omo-agents session names are considered", async () => {
		// given
		fixture.setCandidates(["main", "omo-agents-99999", "omo-agents-99999-1-2", "other-session", "omo-agents-abc"])
		fixture.setAlive(() => false)

		// when
		const result = await sweepStaleOmoAgentSessionsWith(fixture.deps)

		// then
		expect(result).toBe(1)
		expect(fixture.killed).toEqual(["omo-agents-99999"])
	})
})

describe("sweepTmuxSessionsWith", () => {
	let fixture: SweepFixture

	beforeEach(() => {
		fixture = createFixture()
	})

	it("#given custom predicate for team sessions #when shared sweep called #then only matching sessions are killed", async () => {
		// given
		fixture.setCandidates(["omo-team-A", "omo-team-B", "main", "omo-agents-99999"])

		// when
		const result = await sweepTmuxSessionsWith(fixture.deps, {
			predicate: (sessionName) => sessionName.startsWith("omo-team-"),
		})

		// then
		expect(result).toEqual(["omo-team-A", "omo-team-B"])
		expect(fixture.killed).toEqual(["omo-team-A", "omo-team-B"])
	})
})

describe("sweepStaleOmoAttachPanesWith", () => {
	it("#given stale and live OMO attach panes #when sweep called #then only panes with dead servers are closed", async () => {
		// given
		const closed: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%dead",
					title: "omo-subagent-dead",
					commandLine: `/bin/sh -c "opencode attach http://127.0.0.1:4101 --session ses_dead --dir /tmp/project"`,
				},
				{
					paneId: "%live",
					title: "omo-subagent-live",
					commandLine: `opencode attach 'http://127.0.0.1:4102/' --session 'ses_live' --dir '/tmp/project'`,
				},
				{
					paneId: "%team",
					title: "omo-team-member",
					commandLine: `opencode attach 'http://127.0.0.1:4104/' --session 'ses_team' --dir '/tmp/project'`,
				},
				{
					paneId: "%manual",
					title: "manual-shell",
					commandLine: "opencode attach http://127.0.0.1:4105 --session ses_manual",
				},
				{
					paneId: "%other",
					title: "",
					commandLine: "vim README.md",
				},
			],
			isServerRunning: async (serverUrl: string) => serverUrl === "http://127.0.0.1:4102/",
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(2)
		expect(closed).toEqual(["%dead", "%team"])
	})

	it("#given manual attach pane with dead server #when sweep called #then manual pane is not closed", async () => {
		// given
		const closed: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%manual",
					title: "manual-opencode",
					commandLine: "opencode attach http://127.0.0.1:4105 --session ses_manual",
				},
			],
			isServerRunning: async () => false,
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(0)
		expect(closed).toEqual([])
	})

	it("#given OMO attach pane close fails #when sweep called #then failed close is not counted", async () => {
		// given
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%stubborn",
					title: "omo-subagent-stubborn",
					commandLine: "opencode attach http://127.0.0.1:4103 --session ses_dead",
				},
			],
			isServerRunning: async () => false,
			closePane: async () => false,
			log: () => undefined,
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(0)
	})

	it("#given server health check throws for one pane #when sweep called #then later stale panes are still closed", async () => {
		// given
		const closed: string[] = []
		const logged: string[] = []
		const deps: SweepAttachPaneDeps = {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			listCandidatePanes: async () => [
				{
					paneId: "%bad-health",
					title: "omo-subagent-bad-health",
					commandLine: "opencode attach http://127.0.0.1:4106 --session ses_bad",
				},
				{
					paneId: "%dead",
					title: "omo-subagent-dead",
					commandLine: "opencode attach http://127.0.0.1:4107 --session ses_dead",
				},
			],
			isServerRunning: async (serverUrl: string) => {
				if (serverUrl === "http://127.0.0.1:4106") {
					throw new Error("bad health check")
				}
				return false
			},
			closePane: async (paneId: string) => {
				closed.push(paneId)
				return true
			},
			log: (message: string) => {
				logged.push(message)
			},
		}

		// when
		const result = await sweepStaleOmoAttachPanesWith(deps)

		// then
		expect(result).toBe(1)
		expect(closed).toEqual(["%dead"])
		expect(logged).toContain("[sweepStaleOmoAttachPanesWith] failed to check pane server health")
	})
})
