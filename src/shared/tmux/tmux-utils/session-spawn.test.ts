import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "../../../config/schema"
import type { TmuxCommandResult } from "../runner"

const sessionSpawnSpecifier = import.meta.resolve("./session-spawn")
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
	output: "",
	stdout: "",
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

function getSpawnCommand(): string {
	const newSessionCall = getRunTmuxCommandCall(2)
	const newSessionCommand = newSessionCall[1][newSessionCall[1].length - 1]
	if (newSessionCommand === undefined) {
		throw new Error("Expected new-session command")
	}

	return newSessionCommand
}

async function loadSpawnTmuxSession(): Promise<typeof import("./session-spawn").spawnTmuxSession> {
	const module = await import(`${sessionSpawnSpecifier}?test=${crypto.randomUUID()}`)
	return module.spawnTmuxSession
}

function registerModuleMocks(): void {
	mock.module(environmentSpecifier, () => ({ isInsideTmux: isInsideTmuxMock }))
	mock.module(loggerSpecifier, () => ({ log: logMock }))
	mock.module(runnerSpecifier, () => ({ runTmuxCommand: runTmuxCommandMock }))
	mock.module(serverHealthSpecifier, () => ({ isServerRunning: isServerRunningMock }))
	mock.module(tmuxPathResolverSpecifier, () => ({ getTmuxPath: getTmuxPathMock }))
}

describe("spawnTmuxSession runner integration", () => {
	beforeEach(() => {
		mock.restore()
		registerModuleMocks()
		runTmuxCommandMock.mockClear()
		isInsideTmuxMock.mockClear()
		isServerRunningMock.mockClear()
		getTmuxPathMock.mockClear()
		logMock.mockClear()

		const tmuxCommandResults: TmuxCommandResult[] = [
			{ success: true, output: "120,40", stdout: "120,40", stderr: "", exitCode: 0 },
			{ success: false, output: "", stdout: "", stderr: "", exitCode: 1 },
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

	it("#given source pane available #when spawnTmuxSession called #then delegates display, has-session, new-session, and select-pane to shared runner", async () => {
		// given
		const spawnTmuxSession = await loadSpawnTmuxSession()
		const directory = "/tmp/omo-project/(session)"

		// when
		const result = await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory, "%0")

		// then
		const displayCall = getRunTmuxCommandCall(0)
		const hasSessionCall = getRunTmuxCommandCall(1)
		const newSessionCall = getRunTmuxCommandCall(2)
		const selectPaneCall = getRunTmuxCommandCall(3)
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(displayCall[1]).toEqual(["display", "-p", "-t", "%0", "#{window_width},#{window_height}"])
		expect(hasSessionCall[1][0]).toBe("has-session")
		expect(hasSessionCall[1][1]).toBe("-t")
		expect(hasSessionCall[1][2]?.startsWith("omo-agents-")).toBe(true)
		expect(newSessionCall[1].slice(0, 4)).toEqual(["new-session", "-d", "-s", newSessionCall[1][3]])
		expect(String(newSessionCall[1][3]).startsWith("omo-agents-")).toBe(true)
		expect(selectPaneCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(getSpawnCommand()).toContain(` --dir '${directory}'`)
	})

	it("#given directory with spaces #when spawnTmuxSession called #then wraps --dir value in single quotes", async () => {
		// given
		const spawnTmuxSession = await loadSpawnTmuxSession()

		// when
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here", "%0")

		// then
		expect(getSpawnCommand()).toContain("--dir '/path with spaces/here'")
	})

	it("#given empty directory #when spawnTmuxSession called #then falls back to process cwd", async () => {
		// given
		const spawnTmuxSession = await loadSpawnTmuxSession()

		// when
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "", "%0")

		// then
		expect(getSpawnCommand()).toContain(`--dir '${process.cwd()}'`)
	})

	it("#given directory with single quotes #when spawnTmuxSession called #then escapes the value with POSIX-safe single quoting", async () => {
		// given
		const spawnTmuxSession = await loadSpawnTmuxSession()

		// when
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote", "%0")

		// then
		expect(getSpawnCommand()).toContain("--dir '/path/with'\\''quote'")
	})
})
