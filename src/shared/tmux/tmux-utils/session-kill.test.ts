import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const sessionKillSpecifier = import.meta.resolve("./session-kill")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "",
	stdout: "",
	stderr: "",
	exitCode: 0,
}))
const isInsideTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "tmux")
const logMock = mock(() => undefined)

async function loadKillTmuxSessionIfExists(): Promise<typeof import("./session-kill").killTmuxSessionIfExists> {
	const module = await import(`${sessionKillSpecifier}?test=${crypto.randomUUID()}`)
	return module.killTmuxSessionIfExists
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("killTmuxSessionIfExists", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({
			success: true,
			output: "",
			stdout: "",
			stderr: "",
			exitCode: 0,
		})
		isInsideTmuxMock.mockReturnValue(true)
		getTmuxPathMock.mockResolvedValue("tmux")
	})

	it("#given omo-agents session exists #when killTmuxSessionIfExists called #then kill-session invoked and returns true", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(true)
		expect(runTmuxCommandMock.mock.calls).toEqual([
			["tmux", ["has-session", "-t", "omo-agents"]],
			["tmux", ["kill-session", "-t", "omo-agents"]],
		])
	})

	it("#given omo-agents session does NOT exist #when killTmuxSessionIfExists called #then NO kill-session invocation and returns false", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		runTmuxCommandMock.mockResolvedValueOnce({ success: false, output: "", stdout: "", stderr: "", exitCode: 1 })

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock.mock.calls).toEqual([["tmux", ["has-session", "-t", "omo-agents"]]])
	})

	it("#given not inside tmux #when killTmuxSessionIfExists called #then returns false without runner calls", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		isInsideTmuxMock.mockReturnValue(false)

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).not.toHaveBeenCalled()
	})

	it("#given tmux not found #when killTmuxSessionIfExists called #then returns false without runner calls", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		getTmuxPathMock.mockResolvedValue(undefined)

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).not.toHaveBeenCalled()
	})

	it("#given kill-session itself fails #when killTmuxSessionIfExists called #then returns false but does not throw", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()
		runTmuxCommandMock
			.mockResolvedValueOnce({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ success: false, output: "", stdout: "", stderr: "no session", exitCode: 1 })

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(2)
	})
})
