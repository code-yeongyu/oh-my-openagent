import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const staleSessionSweepSpecifier = import.meta.resolve("./stale-session-sweep")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const runnerSpecifier = import.meta.resolve("../runner")
const sessionKillSpecifier = import.meta.resolve("./session-kill")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "",
	stdout: "",
	stderr: "",
	exitCode: 0,
}))
const killTmuxSessionIfExistsMock = mock(async (): Promise<boolean> => true)
const isInsideTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadSweepStaleOmoAgentSessions(): Promise<typeof import("./stale-session-sweep").sweepStaleOmoAgentSessions> {
	const module = await import(`${staleSessionSweepSpecifier}?test=${crypto.randomUUID()}`)
	return module.sweepStaleOmoAgentSessions
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(sessionKillSpecifier, () => ({ killTmuxSessionIfExists: killTmuxSessionIfExistsMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("sweepStaleOmoAgentSessions runtime runner integration", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		killTmuxSessionIfExistsMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({
			success: true,
			output: "omo-agents-99991\nomo-agents-99992",
			stdout: "omo-agents-99991\nomo-agents-99992",
			stderr: "",
			exitCode: 0,
		})
		killTmuxSessionIfExistsMock.mockResolvedValue(true)
		isInsideTmuxMock.mockReturnValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given stale sessions listed by tmux #when sweepStaleOmoAgentSessions called #then delegates list-sessions to shared runner", async () => {
		// given
		const sweepStaleOmoAgentSessions = await loadSweepStaleOmoAgentSessions()

		// when
		const result = await sweepStaleOmoAgentSessions()

		// then
		expect(result).toBe(2)
		expect(runTmuxCommandMock.mock.calls).toEqual([
			["sh", ["list-sessions", "-F", "#{session_name}"]],
		])
		expect(killTmuxSessionIfExistsMock).toHaveBeenCalledTimes(2)
	})
})
