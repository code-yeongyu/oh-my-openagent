import { describe, expect, it } from "bun:test"

import type { TmuxConfig } from "../../../config/schema"
import type { TmuxCommandResult } from "../runner"
import { spawnTmuxWindow } from "./window-spawn"

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

type SpawnTmuxWindowDeps = NonNullable<Parameters<typeof spawnTmuxWindow>[5]>

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		throw new Error("Expected array value")
	}

	const items: string[] = []
	for (const item of value) {
		items.push(String(item))
	}
	return items
}

function defaultTmuxCommandResults(): TmuxCommandResult[] {
	return [
		{ success: true, output: "%42", stdout: "%42", stderr: "", exitCode: 0 },
		{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
	]
}

function createHarness() {
	const calls: Array<[string, string[]]> = []
	const tmuxCommandResults = defaultTmuxCommandResults()
	const runTmuxCommand = async (command: string, args: string[]): Promise<TmuxCommandResult> => {
		calls.push([command, [...args]])
		const nextResult = tmuxCommandResults.shift()
		if (!nextResult) {
			throw new Error("No more tmux command results configured")
		}
		return nextResult
	}
	const deps: SpawnTmuxWindowDeps = {
		log: () => undefined,
		runTmuxCommand,
		isInsideTmux: (): boolean => true,
		isServerRunning: async (): Promise<boolean> => true,
		getTmuxPath: async (): Promise<string | null> => "sh",
	}

	function getRunTmuxCommandCall(index: number): [string, string[]] {
		const call = calls[index]
		if (!call) {
			throw new Error(`Expected tmux runner call at index ${index}`)
		}

		return [call[0], toStringArray(call[1])]
	}

	function getNewWindowCommand(): string {
		const firstCall = getRunTmuxCommandCall(0)
		const newWindowCommand = firstCall[1][7]
		if (newWindowCommand === undefined) {
			throw new Error("Expected new-window command")
		}

		return newWindowCommand
	}

	return { deps, getRunTmuxCommandCall, getNewWindowCommand }
}

describe("spawnTmuxWindow runner integration", () => {
	it("#given healthy tmux environment #when spawnTmuxWindow called #then delegates new-window and select-pane to shared runner", async () => {
		// given
		const harness = createHarness()
		const directory = "/tmp/omo-project/(window)"

		// when
		const result = await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory, harness.deps)

		// then
		const firstCall = harness.getRunTmuxCommandCall(0)
		const secondCall = harness.getRunTmuxCommandCall(1)
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(firstCall[1].slice(0, 7)).toEqual(["new-window", "-d", "-n", "omo-agents", "-P", "-F", "#{pane_id}"])
		expect(secondCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(harness.getNewWindowCommand()).toContain("Attaching automatically when the session is ready.")
		expect(harness.getNewWindowCommand()).toContain("tail -f /dev/null")
		expect(harness.getNewWindowCommand()).not.toContain("opencode attach")
	})

	it("#given description with spaces #when spawnTmuxWindow called #then includes it in the placeholder", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxWindow("session-1", "worker with spaces", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here", harness.deps)

		// then
		expect(harness.getNewWindowCommand()).toContain("OMO subagent pane ready: worker with spaces")
	})

	it("#given empty directory #when spawnTmuxWindow called #then keeps the placeholder detached from attach", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "", harness.deps)

		// then
		expect(harness.getNewWindowCommand()).not.toContain("--dir")
	})

	it("#given description with shell metacharacters #when spawnTmuxWindow called #then escapes the placeholder", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxWindow("session-1", 'worker "$(whoami)"', enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote", harness.deps)

		// then
		expect(harness.getNewWindowCommand()).toContain('worker "$(whoami)"')
		expect(harness.getNewWindowCommand()).toContain("'\\''OMO subagent pane ready")
	})
})
