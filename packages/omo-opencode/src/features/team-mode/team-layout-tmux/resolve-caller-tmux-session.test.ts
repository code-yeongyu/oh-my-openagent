import { describe, expect, mock, test } from "bun:test"
import type { TmuxCommandResult } from "../../../shared/tmux"

import { resolveCallerTmuxSession } from "./resolve-caller-tmux-session"

type TmuxCall = {
	tmuxPath: string
	args: string[]
}

function tmuxResult(output: string, exitCode: number = 0): TmuxCommandResult {
	return {
		success: exitCode === 0,
		output,
		stdout: output,
		stderr: "",
		exitCode,
	}
}

function createRunCommandMock(results: TmuxCommandResult[]) {
	const calls: TmuxCall[] = []
	const runCommand = mock(async (tmuxPath: string, args: string[]): Promise<TmuxCommandResult> => {
		calls.push({ tmuxPath, args })
		return results.shift() ?? tmuxResult("", 1)
	})

	return { calls, runCommand }
}

describe("resolveCallerTmuxSession", () => {
	test("#given TMUX_PANE unset #when resolve runs #then returns null and makes no tmux calls", async () => {
		// given
		const { calls, runCommand } = createRunCommandMock([tmuxResult("$7")])

		// when
		const result = await resolveCallerTmuxSession("tmux", "", runCommand)

		// then
		expect(result).toBeNull()
		expect(calls).toHaveLength(0)
	})

	test("#given TMUX_PANE=%42 and display returns session and window #when resolve runs #then returns caller tmux target", async () => {
		// given
		const { calls, runCommand } = createRunCommandMock([
			tmuxResult("$7"),
			tmuxResult("test-session:0"),
		])

		// when
		const result = await resolveCallerTmuxSession("tmux", "%42", runCommand)

		// then
		expect(result).toEqual({ sessionId: "$7", paneId: "%42", windowTarget: "test-session:0" })
		expect(calls).toEqual([
			{ tmuxPath: "tmux", args: ["display", "-p", "-F", "#{session_id}", "-t", "%42"] },
			{ tmuxPath: "tmux", args: ["display", "-p", "-F", "#{session_name}:#{window_index}", "-t", "%42"] },
		])
	})

	test("#given TMUX_PANE=%42 and display returns 'garbage' #when resolve runs #then returns null", async () => {
		// given
		const { runCommand } = createRunCommandMock([tmuxResult("garbage")])

		// when
		const result = await resolveCallerTmuxSession("tmux", "%42", runCommand)

		// then
		expect(result).toBeNull()
	})

	test("#given TMUX_PANE=%42 and display exits non-success #when resolve runs #then returns null", async () => {
		// given
		const { runCommand } = createRunCommandMock([tmuxResult("$7", 1)])

		// when
		const result = await resolveCallerTmuxSession("tmux", "%42", runCommand)

		// then
		expect(result).toBeNull()
	})
})
