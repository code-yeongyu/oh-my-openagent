import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const layoutSpecifier = import.meta.resolve("./layout")
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
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadEnforceMainPaneWidth(): Promise<typeof import("./layout").enforceMainPaneWidth> {
	const module = await import(`${layoutSpecifier}?test=${crypto.randomUUID()}`)
	return module.enforceMainPaneWidth
}

function registerModuleMocks(): void {
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("enforceMainPaneWidth runner integration", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({ success: true, output: "", stdout: "", stderr: "", exitCode: 0 })
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given pane width inputs #when enforceMainPaneWidth called #then delegates resize-pane to shared runner", async () => {
		// given
		const enforceMainPaneWidth = await loadEnforceMainPaneWidth()

		// when
		await enforceMainPaneWidth("%42", 200, 60)

		// then
		expect(runTmuxCommandMock.mock.calls).toEqual([
			[[expect.any(String), ["resize-pane", "-t", "%42", "-x", "119"]]][0],
		])
	})
})
