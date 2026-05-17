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
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "tmux")
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

describe("closeTmuxPane", () => {
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

	it("#given pane exists #when closeTmuxPane called #then returns true and invokes send-keys + kill-pane in order", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(true)
		expect(runTmuxCommandMock).toHaveBeenCalledTimes(2)
		expect(runTmuxCommandMock).toHaveBeenNthCalledWith(1, "tmux", ["send-keys", "-t", "%42", "C-c"])
		expect(runTmuxCommandMock).toHaveBeenNthCalledWith(2, "tmux", ["kill-pane", "-t", "%42"])
	})

	it("#given not inside tmux #when closeTmuxPane called #then returns false without runner calls", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		isInsideTmuxMock.mockReturnValue(false)

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).not.toHaveBeenCalled()
	})

	it("#given tmux not found #when closeTmuxPane called #then returns false without runner calls", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		getTmuxPathMock.mockResolvedValue(undefined)

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
		expect(runTmuxCommandMock).not.toHaveBeenCalled()
	})

	it("#given kill-pane fails with unknown error #when closeTmuxPane called #then returns false", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		runTmuxCommandMock
			.mockResolvedValueOnce({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ success: false, output: "", stdout: "", stderr: "permission denied", exitCode: 1 })

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(false)
	})

	it("#given pane already closed by Ctrl+C #when kill-pane reports can't find pane #then returns true", async () => {
		// given
		const closeTmuxPane = await loadCloseTmuxPane()
		runTmuxCommandMock
			.mockResolvedValueOnce({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ success: false, output: "", stdout: "", stderr: "can't find pane: %42", exitCode: 1 })

		// when
		const result = await closeTmuxPane("%42")

		// then
		expect(result).toBe(true)
	})
})
