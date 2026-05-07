import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxCommandResult } from "../../shared/tmux"
import { queryWindowStateWithDeps } from "./pane-state-querier"

const runTmuxCommandMock = mock(async (): Promise<TmuxCommandResult> => ({
	success: true,
	output: "",
	stdout: "",
	stderr: "",
	exitCode: 0,
}))
const getTmuxPathMock = mock(async (): Promise<string | null> => "sh")
const logMock = mock(() => undefined)

describe("queryWindowState runner integration", () => {
  beforeEach(() => {
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
    const result = await queryWindowStateWithDeps("%0", {
      getTmuxPath: getTmuxPathMock,
      runTmuxCommand: runTmuxCommandMock,
      log: logMock,
    })

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
