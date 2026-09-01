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
const isNativeTmuxMock = mock((): boolean => true)
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadKillTmuxSessionIfExists(): Promise<typeof import("./session-kill").killTmuxSessionIfExists> {
	const module = await import(`${sessionKillSpecifier}?test=${crypto.randomUUID()}`)
	return module.killTmuxSessionIfExists
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({
		isInsideTmux: isInsideTmuxMock,
		isNativeTmux: isNativeTmuxMock,
		isTmuxPaneCompatible: isInsideTmuxMock,
	}))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("killTmuxSessionIfExists runner integration", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		isNativeTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock
			.mockResolvedValueOnce({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
		isInsideTmuxMock.mockReturnValue(true)
		isNativeTmuxMock.mockReturnValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given session exists #when killTmuxSessionIfExists called #then delegates has-session and kill-session to shared runner", async () => {
		// given
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(true)
		expect(runTmuxCommandMock.mock.calls).toEqual([
			["sh", ["has-session", "-t", "omo-agents"]],
			["sh", ["kill-session", "-t", "omo-agents"]],
		])
	})

	it("#given cmux fake TMUX is not native #when killTmuxSessionIfExists called #then skips session commands", async () => {
		// given
		isInsideTmuxMock.mockReturnValue(true)
		isNativeTmuxMock.mockReturnValue(false)
		const killTmuxSessionIfExists = await loadKillTmuxSessionIfExists()

		// when
		const result = await killTmuxSessionIfExists("omo-agents")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).not.toHaveBeenCalled()
	})
})
