import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import { closeTmuxPaneWithDependencies } from "./pane-close"

type CloseTmuxPaneDependencies = Parameters<typeof closeTmuxPaneWithDependencies>[1]

type TmuxCommandCall = {
	readonly tmux: string
	readonly args: string[]
}

type ClosePaneFixture = {
	readonly calls: TmuxCommandCall[]
	readonly delayCalls: number[]
	readonly dependencies: CloseTmuxPaneDependencies
}

type FixtureOptions = {
	readonly insideTmux?: boolean
	readonly tmuxPath?: string | undefined
	readonly results?: TmuxCommandResult[]
}

function tmuxResult(overrides: Partial<TmuxCommandResult> = {}): TmuxCommandResult {
	return {
		success: true,
		output: "",
		stdout: "",
		stderr: "",
		exitCode: 0,
		...overrides,
	}
}

function createFixture(options: FixtureOptions = {}): ClosePaneFixture {
	const calls: TmuxCommandCall[] = []
	const delayCalls: number[] = []
	const results = [...(options.results ?? [tmuxResult()])]
	const tmuxPath = "tmuxPath" in options ? options.tmuxPath : "tmux"

	return {
		calls,
		delayCalls,
		dependencies: {
			isInsideTmux: () => options.insideTmux ?? true,
			getTmuxPath: async () => tmuxPath,
			runTmuxCommand: async (tmux, args) => {
				calls.push({ tmux, args: [...args] })
				return results.shift() ?? tmuxResult()
			},
			log: () => undefined,
			delay: async (milliseconds) => {
				delayCalls.push(milliseconds)
			},
		},
	}
}

describe("closeTmuxPane", () => {
	it("#given pane exists #when closeTmuxPane called #then returns true and invokes send-keys + kill-pane in order", async () => {
		// given
		const fixture = createFixture()

		// when
		const result = await closeTmuxPaneWithDependencies("%42", fixture.dependencies)

		// then
		expect(result).toBe(true)
		expect(fixture.calls).toEqual([
			{ tmux: "tmux", args: ["send-keys", "-t", "%42", "C-c"] },
			{ tmux: "tmux", args: ["kill-pane", "-t", "%42"] },
		])
		expect(fixture.delayCalls).toEqual([250])
	})

	it("#given not inside tmux #when closeTmuxPane called #then returns false without runner calls", async () => {
		// given
		const fixture = createFixture({ insideTmux: false })

		// when
		const result = await closeTmuxPaneWithDependencies("%42", fixture.dependencies)

		// then
		expect(result).toBe(false)
		expect(fixture.calls).toEqual([])
	})

	it("#given tmux not found #when closeTmuxPane called #then returns false without runner calls", async () => {
		// given
		const fixture = createFixture({ tmuxPath: undefined })

		// when
		const result = await closeTmuxPaneWithDependencies("%42", fixture.dependencies)

		// then
		expect(result).toBe(false)
		expect(fixture.calls).toEqual([])
	})

	it("#given kill-pane fails with unknown error #when closeTmuxPane called #then returns false", async () => {
		// given
		const fixture = createFixture({
			results: [
				tmuxResult(),
				tmuxResult({ success: false, stderr: "permission denied", exitCode: 1 }),
			],
		})

		// when
		const result = await closeTmuxPaneWithDependencies("%42", fixture.dependencies)

		// then
		expect(result).toBe(false)
	})

	it("#given pane already closed by Ctrl+C #when kill-pane reports can't find pane #then returns true", async () => {
		// given
		const fixture = createFixture({
			results: [
				tmuxResult(),
				tmuxResult({ success: false, stderr: "can't find pane: %42", exitCode: 1 }),
			],
		})

		// when
		const result = await closeTmuxPaneWithDependencies("%42", fixture.dependencies)

		// then
		expect(result).toBe(true)
	})

	it("#given cmux eager pane whose opencode attach exited naturally #when kill-pane reports can't find pane #then returns true (eager exit is graceful)", async () => {
		// given — cmux pane exited because opencode attach process terminated on session end
		// polling then attempts kill-pane which finds the pane already gone
		const fixture = createFixture({
			results: [
				tmuxResult(), // send-keys Ctrl+C: pane may already be gone, response ignored
				tmuxResult({ success: false, stderr: "can't find pane: %55", exitCode: 1 }),
			],
		})

		// when
		const result = await closeTmuxPaneWithDependencies("%55", fixture.dependencies)

		// then — already-gone pane is treated as graceful success, no error thrown
		expect(result).toBe(true)
		expect(fixture.calls[1]?.args).toEqual(["kill-pane", "-t", "%55"])
	})
})
