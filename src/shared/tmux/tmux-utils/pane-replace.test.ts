import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "../../../config/schema"
import type { TmuxCommandResult } from "../runner"

const paneReplaceSpecifier = import.meta.resolve("./pane-replace")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const runnerSpecifier = import.meta.resolve("../runner")
const tmuxPathResolverSpecifier = import.meta.resolve("../../../tools/interactive-bash/tmux-path-resolver")

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

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

function getRunTmuxCommandCall(index: number): [string, string[]] {
	const call = Reflect.get(runTmuxCommandMock.mock.calls, index)
	const command = Reflect.get(call, 0)
	const args = Reflect.get(call, 1)
	if (!Array.isArray(call) || typeof command !== "string" || !Array.isArray(args)) {
		throw new Error(`Expected tmux runner call at index ${index}`)
	}

	return [command, toStringArray(args)]
}

function getRespawnCommand(): string {
	const respawnCall = getRunTmuxCommandCall(1)
	const respawnCommand = respawnCall[1][4]
	if (respawnCommand === undefined) {
		throw new Error("Expected respawn-pane command")
	}

	return respawnCommand
}

async function loadReplaceTmuxPane(): Promise<typeof import("./pane-replace").replaceTmuxPane> {
	const module = await import(`${paneReplaceSpecifier}?test=${crypto.randomUUID()}`)
	return module.replaceTmuxPane
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("replaceTmuxPane runner integration", () => {
	beforeEach(() => {
		mock.restore()
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		const tmuxCommandResults: TmuxCommandResult[] = [
			{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
			{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
			{ success: true, output: "", stdout: "", stderr: "", exitCode: 0 },
		]
		runTmuxCommandMock.mockImplementation(async (): Promise<TmuxCommandResult> => {
			const nextResult = tmuxCommandResults.shift()
			if (!nextResult) {
				throw new Error("No more tmux command results configured")
			}
			return nextResult
		})
		isInsideTmuxMock.mockReturnValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given existing pane #when replaceTmuxPane called #then delegates send-keys, respawn-pane, and select-pane to shared runner", async () => {
		// given
		const replaceTmuxPane = await loadReplaceTmuxPane()
		const directory = "/tmp/omo-project/(replace)"

		// when
		const result = await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory)

		// then
		const sendKeysCall = getRunTmuxCommandCall(0)
		const respawnCall = getRunTmuxCommandCall(1)
		const selectPaneCall = getRunTmuxCommandCall(2)
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(sendKeysCall[1]).toEqual(["send-keys", "-t", "%42", "C-c"])
		expect(respawnCall[1].slice(0, 4)).toEqual(["respawn-pane", "-k", "-t", "%42"])
		expect(selectPaneCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(getRespawnCommand()).toContain(` --dir '${directory}'`)
	})

	it("#given directory with spaces #when replaceTmuxPane called #then wraps --dir value in single quotes", async () => {
		// given
		const replaceTmuxPane = await loadReplaceTmuxPane()

		// when
		await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here")

		// then
		expect(getRespawnCommand()).toContain("--dir '/path with spaces/here'")
	})

	it("#given empty directory #when replaceTmuxPane called #then falls back to process cwd", async () => {
		// given
		const replaceTmuxPane = await loadReplaceTmuxPane()

		// when
		await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "")

		// then
		expect(getRespawnCommand()).toContain(`--dir '${process.cwd()}'`)
	})

	it("#given directory with single quotes #when replaceTmuxPane called #then escapes the value with POSIX-safe single quoting", async () => {
		// given
		const replaceTmuxPane = await loadReplaceTmuxPane()

		// when
		await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote")

		// then
		expect(getRespawnCommand()).toContain("--dir '/path/with'\\''quote'")
	})
})
