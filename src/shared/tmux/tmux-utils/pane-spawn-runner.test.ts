/// <reference types="bun-types" />

import { beforeEach, describe, expect, it, mock } from "bun:test"

import type { TmuxConfig } from "../../../config/schema"
import type { TmuxCommandResult } from "../runner"

const paneSpawnSpecifier = import.meta.resolve("./pane-spawn")

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
const getTmuxPathMock = mock(async (): Promise<string | null> => "sh")
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

function getSplitWindowCommand(): string {
	const firstCall = getRunTmuxCommandCall(0)
	const splitCommand = firstCall[1][8]
	if (splitCommand === undefined) {
		throw new Error("Expected split-window command")
	}

	return splitCommand
}

function createDeps(): NonNullable<Parameters<typeof import("./pane-spawn").spawnTmuxPane>[7]> {
	return {
		log: logMock,
		runTmuxCommand: runTmuxCommandMock,
		isInsideTmux: isInsideTmuxMock,
		isServerRunning: isServerRunningMock,
		getTmuxPath: getTmuxPathMock,
	}
}

async function loadSpawnTmuxPane(): Promise<typeof import("./pane-spawn").spawnTmuxPane> {
	const module = await import(`${paneSpawnSpecifier}?test=${crypto.randomUUID()}`)
	return module.spawnTmuxPane
}

describe("spawnTmuxPane runner integration", () => {
	beforeEach(() => {
		mock.restore()
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

	it("#given healthy tmux environment #when spawnTmuxPane called #then delegates split-window and select-pane to shared runner", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()
		const directory = "/tmp/omo-project/(pane)"

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", directory, "%0", "-h", createDeps())

		// then
		const firstCall = getRunTmuxCommandCall(0)
		const secondCall = getRunTmuxCommandCall(1)
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(firstCall[1].slice(0, 8)).toEqual(["split-window", "-h", "-d", "-P", "-F", "#{pane_id}", "-t", "%0"])
		expect(secondCall[1]).toEqual(["select-pane", "-t", "%42", "-T", "omo-subagent-worker"])
		expect(getSplitWindowCommand()).toContain(` --dir '${directory}'`)
	})

	it("#given directory with spaces #when spawnTmuxPane called #then wraps --dir value in single quotes", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path with spaces/here", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).toContain("--dir '/path with spaces/here'")
	})

	it("#given empty directory #when spawnTmuxPane called #then falls back to process cwd", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).toContain(`--dir '${process.cwd()}'`)
	})

	it("#given directory with single quotes #when spawnTmuxPane called #then escapes the value with POSIX-safe single quoting", async () => {
		// given
		const spawnTmuxPane = await loadSpawnTmuxPane()

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:1234", "/path/with'quote", "%0", "-h", createDeps())

		// then
		expect(getSplitWindowCommand()).toContain("--dir '/path/with'\\''quote'")
	})
})
