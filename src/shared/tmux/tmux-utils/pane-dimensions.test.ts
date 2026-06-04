import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../runner"

const paneDimensionsSpecifier = import.meta.resolve("./pane-dimensions")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "80,160",
	stdout: "80,160",
	stderr: "",
	exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")

async function loadGetPaneDimensions(): Promise<typeof import("./pane-dimensions").getPaneDimensions> {
	const module = await import(`${paneDimensionsSpecifier}?test=${crypto.randomUUID()}`)
	return module.getPaneDimensions
}

function registerModuleMocks(): void {
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("getPaneDimensions runner integration", () => {
	beforeEach(() => {
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		getTmuxPathMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({ success: true, output: "80,160", stdout: "80,160", stderr: "", exitCode: 0 })
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given pane id #when getPaneDimensions called #then delegates display to shared runner", async () => {
		// given
		const getPaneDimensions = await loadGetPaneDimensions()

		// when
		const result = await getPaneDimensions("%42")

		// then
		expect(result).toEqual({ paneWidth: 80, windowWidth: 160 })
		expect(runTmuxCommandMock.mock.calls).toEqual([
			[[expect.any(String), ["display", "-p", "-t", "%42", "#{pane_width},#{window_width}"]]][0],
		])
	})
})
