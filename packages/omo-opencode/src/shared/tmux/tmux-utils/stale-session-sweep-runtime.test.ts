import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

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
const killTmuxSessionIfExistsMock = mock(async (_sessionName: string): Promise<boolean> => true)
const isInsideTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

let liveChild: Bun.Subprocess | undefined

async function loadSweepStaleOmoAgentSessions(): Promise<typeof import("./stale-session-sweep").sweepStaleOmoAgentSessions> {
	const module = await import(`${staleSessionSweepSpecifier}?test=${crypto.randomUUID()}`)
	return module.sweepStaleOmoAgentSessions
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({
		isInsideTmux: isInsideTmuxMock,
		isNativeTmux: isInsideTmuxMock,
		isTmuxPaneCompatible: isInsideTmuxMock,
	}))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(sessionKillSpecifier, () => ({ killTmuxSessionIfExists: killTmuxSessionIfExistsMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

function listSessions(names: string[]): void {
	const output = names.join("\n")
	runTmuxCommandMock.mockResolvedValue({ success: true, output, stdout: output, stderr: "", exitCode: 0 })
}

async function spawnExitedPid(): Promise<number> {
	const child = Bun.spawn([process.execPath, "-e", ""], { stdout: "ignore", stderr: "ignore" })
	await child.exited
	return child.pid
}

function spawnLivePid(): number {
	liveChild = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" })
	return liveChild.pid
}

describe("sweepStaleOmoAgentSessions runtime runner integration", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		killTmuxSessionIfExistsMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		killTmuxSessionIfExistsMock.mockResolvedValue(true)
		isInsideTmuxMock.mockReturnValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	afterEach(async () => {
		if (liveChild) {
			liveChild.kill()
			await liveChild.exited
			liveChild = undefined
		}
	})

	it("#given a session whose pid has exited #when sweepStaleOmoAgentSessions called #then delegates list-sessions to shared runner and kills it", async () => {
		// given
		const deadSession = `omo-agents-${await spawnExitedPid()}`
		listSessions([deadSession])
		const sweepStaleOmoAgentSessions = await loadSweepStaleOmoAgentSessions()

		// when
		const result = await sweepStaleOmoAgentSessions()

		// then
		expect(result).toBe(1)
		expect(runTmuxCommandMock.mock.calls).toEqual([
			["sh", ["list-sessions", "-F", "#{session_name}"]],
		])
		expect(killTmuxSessionIfExistsMock.mock.calls).toEqual([[deadSession]])
	})

	it("#given a session whose pid is alive #when sweepStaleOmoAgentSessions called #then leaves it alone", async () => {
		// given
		const liveSession = `omo-agents-${spawnLivePid()}`
		listSessions([liveSession])
		const sweepStaleOmoAgentSessions = await loadSweepStaleOmoAgentSessions()

		// when
		const result = await sweepStaleOmoAgentSessions()

		// then
		expect(result).toBe(0)
		expect(killTmuxSessionIfExistsMock).not.toHaveBeenCalled()
	})

	it("#given list-sessions exits non-zero #when stale sweep called #then exposes the error for retry", async () => {
		// given
		runTmuxCommandMock.mockResolvedValue({
			success: false,
			output: "",
			stdout: "",
			stderr: "tmux server is unavailable",
			exitCode: 1,
		})
		const sweepStaleOmoAgentSessions = await loadSweepStaleOmoAgentSessions()

		// when / then
		await expect(sweepStaleOmoAgentSessions()).rejects.toThrow(
			"tmux list-sessions failed with exit code 1: tmux server is unavailable",
		)
	})
})
