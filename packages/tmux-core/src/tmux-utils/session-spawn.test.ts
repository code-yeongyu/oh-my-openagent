import { describe, expect, it } from "bun:test"

import type { TmuxConfig } from "../types"
import type { TmuxCommandResult } from "../runner"
import { spawnTmuxSession } from "./session-spawn"

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

type SpawnTmuxSessionDeps = NonNullable<Parameters<typeof spawnTmuxSession>[6]>

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
		{ success: true, output: "120,40", stdout: "120,40", stderr: "", exitCode: 0 },
		{ success: false, output: "", stdout: "", stderr: "", exitCode: 1 },
		{ success: true, output: "%42", stdout: "%42", stderr: "", exitCode: 0 },
		{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
	]
}

function createHarness() {
	const calls: Array<[string, string[]]> = []
	const logs: string[] = []
	const tmuxCommandResults = defaultTmuxCommandResults()
	const runTmuxCommand = async (command: string, args: string[]): Promise<TmuxCommandResult> => {
		calls.push([command, [...args]])
		const nextResult = tmuxCommandResults.shift()
		if (!nextResult) {
			throw new Error("No more tmux command results configured")
		}
		return nextResult
	}
	const deps: SpawnTmuxSessionDeps = {
		log: (message) => {
			logs.push(message)
		},
		runTmuxCommand,
		isInsideTmux: (): boolean => true,
		isServerRunning: async (): Promise<boolean> => true,
		getTmuxPath: async (): Promise<string | null> => "sh",
	}

	function getRunTmuxCommandCall(index: number): [string, string[]] {
		const call = calls[index]
		if (!call) {
			throw new Error(`Expected tmux runner call at index ${index}; logs: ${logs.join(", ")}`)
		}

		return [call[0], toStringArray(call[1])]
	}

	function getSpawnCommand(): string {
		const newSessionCall = getRunTmuxCommandCall(2)
		const newSessionCommand = newSessionCall[1][newSessionCall[1].length - 1]
		if (newSessionCommand === undefined) {
			throw new Error("Expected new-session command")
		}

		return newSessionCommand
	}

	return { deps, getRunTmuxCommandCall, getSpawnCommand }
}

describe("spawnTmuxSession runner integration", () => {
	it("#given source pane available #when spawnTmuxSession called #then delegates display, has-session, new-session, and select-pane to shared runner", async () => {
		// given
		const harness = createHarness()
		const directory = "/tmp/omo-project/(session)"

		// when
		const result = await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory, "%0", harness.deps)

		// then
		expect(result).toEqual({ success: true, paneId: "%42" })
		const displayCall = harness.getRunTmuxCommandCall(0)
		const hasSessionCall = harness.getRunTmuxCommandCall(1)
		const newSessionCall = harness.getRunTmuxCommandCall(2)
		const selectPaneCall = harness.getRunTmuxCommandCall(3)
		expect(displayCall[1]).toEqual(["display", "-p", "-t", "%0", "#{window_width},#{window_height}"])
		expect(hasSessionCall[1][0]).toBe("has-session")
		expect(hasSessionCall[1][1]).toBe("-t")
		expect(hasSessionCall[1][2]?.startsWith("omo-agents-")).toBe(true)
		expect(newSessionCall[1].slice(0, 4)).toEqual(["new-session", "-d", "-s", newSessionCall[1][3]])
		expect(String(newSessionCall[1][3]).startsWith("omo-agents-")).toBe(true)
		expect(selectPaneCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(harness.getSpawnCommand()).toContain("Focus this pane to attach.")
		expect(harness.getSpawnCommand()).toContain("while :; do sleep 86400; done")
		expect(harness.getSpawnCommand()).not.toContain("opencode attach")
	})

	it("#given description with spaces #when spawnTmuxSession called #then includes it in the placeholder", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxSession("session-1", "worker with spaces", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here", "%0", harness.deps)

		// then
		expect(harness.getSpawnCommand()).toContain("OMO subagent pane ready: worker with spaces")
	})

	it("#given empty directory #when spawnTmuxSession called #then keeps the placeholder detached from attach", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "", "%0", harness.deps)

		// then
		expect(harness.getSpawnCommand()).not.toContain("--dir")
	})

	it("#given description with shell metacharacters #when spawnTmuxSession called #then escapes the placeholder", async () => {
		// given
		const harness = createHarness()

		// when
		await spawnTmuxSession("session-1", 'worker "$(whoami)"', enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote", "%0", harness.deps)

		// then
		expect(harness.getSpawnCommand()).toContain('\\"')
		expect(harness.getSpawnCommand()).toContain("\\$")
	})
})
