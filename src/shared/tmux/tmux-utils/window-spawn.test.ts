import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "../../../config/schema"
import type { TmuxCommandResult } from "../runner"

const windowSpawnSpecifier = import.meta.resolve("./window-spawn")
const environmentSpecifier = import.meta.resolve("./environment")
const loggerSpecifier = import.meta.resolve("../../logger")
const runnerSpecifier = import.meta.resolve("../runner")
const serverHealthSpecifier = import.meta.resolve("./server-health")
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
	output: "%42",
	stdout: "%42",
	stderr: "",
	exitCode: 0,
}))
const isInsideTmuxMock = mock((): boolean => true)
const isServerRunningMock = mock(async (): Promise<boolean> => true)
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

function getNewWindowCommand(): string {
	const firstCall = getRunTmuxCommandCall(0)
	const newWindowCommand = firstCall[1][7]
	if (newWindowCommand === undefined) {
		throw new Error("Expected new-window command")
	}

	return newWindowCommand
}

async function loadSpawnTmuxWindow(): Promise<typeof import("./window-spawn").spawnTmuxWindow> {
	const module = await import(`${windowSpawnSpecifier}?test=${crypto.randomUUID()}`)
	return module.spawnTmuxWindow
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(serverHealthSpecifier, () => ({ isServerRunning: isServerRunningMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("spawnTmuxWindow runner integration", () => {
	beforeEach(() => {
		mock.restore()
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		isServerRunningMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		const tmuxCommandResults: TmuxCommandResult[] = [
			{ success: true, output: "%42", stdout: "%42", stderr: "", exitCode: 0 },
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
		isServerRunningMock.mockResolvedValue(true)
		getTmuxPathMock.mockResolvedValue("sh")
	})

	it("#given healthy tmux environment #when spawnTmuxWindow called #then delegates new-window and select-pane to shared runner", async () => {
		// given
		const spawnTmuxWindow = await loadSpawnTmuxWindow()
		const directory = "/tmp/omo-project/(window)"

		// when
		const result = await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory)

		// then
		const firstCall = getRunTmuxCommandCall(0)
		const secondCall = getRunTmuxCommandCall(1)
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(firstCall[1].slice(0, 7)).toEqual(["new-window", "-d", "-n", "omo-agents", "-P", "-F", "#{pane_id}"])
		expect(secondCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(getNewWindowCommand()).toContain(` --dir '${directory}'`)
	})

	it("#given directory with spaces #when spawnTmuxWindow called #then wraps --dir value in single quotes", async () => {
		// given
		const spawnTmuxWindow = await loadSpawnTmuxWindow()

		// when
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here")

		// then
		expect(getNewWindowCommand()).toContain("--dir '/path with spaces/here'")
	})

	it("#given empty directory #when spawnTmuxWindow called #then falls back to process cwd", async () => {
		// given
		const spawnTmuxWindow = await loadSpawnTmuxWindow()

		// when
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "")

		// then
		expect(getNewWindowCommand()).toContain(`--dir '${process.cwd()}'`)
	})

	it("#given directory with single quotes #when spawnTmuxWindow called #then escapes the value with POSIX-safe single quoting", async () => {
		// given
		const spawnTmuxWindow = await loadSpawnTmuxWindow()

		// when
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote")

		// then
		expect(getNewWindowCommand()).toContain("--dir '/path/with'\\''quote'")
	})
})
