import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const paneCloseSpecifier = import.meta.resolve("./pane-close")
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
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadCloseTmuxPane(): Promise<typeof import("./pane-close").closeTmuxPane> {
	const module = await import(`${paneCloseSpecifier}?test=${crypto.randomUUID()}`)
	return module.closeTmuxPane
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("closeTmuxPane runner integration", () => {
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
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given pane exists #when closeTmuxPane called #then delegates send-keys and kill-pane to shared runner", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(true)
		expect(runTmuxCommandMock.mock.calls).toEqual([
			["sh", ["send-keys", "-t", "%42", "C-c"]],
			["sh", ["kill-pane", "-t", "%42"]],
		])
	})
})
