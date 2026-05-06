import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../../shared/tmux"

const paneStateQuerierSpecifier = import.meta.resolve("./pane-state-querier")
const loggerSpecifier = import.meta.resolve("../../shared")
const runnerSpecifier = import.meta.resolve("../../shared/tmux")
const tmuxPathResolverSpecifier = import.meta.resolve("../../tools/interactive-bash/tmux-path-resolver")

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "",
	stdout: "",
	stderr: "",
	exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | undefined> => "sh")
const logMock = mock(() => undefined)

async function loadQueryWindowState(): Promise<typeof import("./pane-state-querier").queryWindowState> {
	const module = await import(`${paneStateQuerierSpecifier}?test=${crypto.randomUUID()}`)
	return module.queryWindowState
}

function registerModuleMocks(): void {
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("queryWindowState runner integration", () => {
	beforeEach(() => {
		mock.restore()
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		runTmuxCommandMock.mockResolvedValue({
			success: true,
			output: "%0\t120\t40\t0\t0\t1\t120\t40\t\n%1\t60\t40\t60\t0\t0\t120\t40\tagent",
			stdout: "%0\t120\t40\t0\t0\t1\t120\t40\t\n%1\t60\t40\t60\t0\t0\t120\t40\tagent",
			stderr: "",
			exitCode: 0,
		})
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given source pane id #when queryWindowState called #then delegates list-panes to shared runner", async () => {
		// given
		const queryWindowState = await loadQueryWindowState()

		// when
		const result = await queryWindowState("%0")

		// then
		expect(result).not.toBeNull()
		if (!result?.mainPane) {
			throw new Error("Expected window state")
		}
		expect(result.mainPane.paneId).toBe("%0")
		expect(result.agentPanes.map((pane) => pane.paneId)).toEqual(["%1"])
		expect(runTmuxCommandMock.mock.calls).toEqual([
			[
				expect.any(String),
				[
					"list-panes",
					"-t",
					"%0",
					"-F",
					"#{pane_id}\t#{pane_width}\t#{pane_height}\t#{pane_left}\t#{pane_top}\t#{pane_active}\t#{window_width}\t#{window_height}\t#{pane_title}",
				],
			],
		])
	})
})
