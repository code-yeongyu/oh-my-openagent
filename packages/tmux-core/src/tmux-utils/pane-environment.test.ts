import { describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import type { TmuxConfig, TmuxServerAccess } from "../types"
import { activateTmuxPane } from "./pane-activate"
import { buildTmuxEnvironmentArgs } from "./pane-command"
import { replaceTmuxPane } from "./pane-replace"
import { spawnTmuxPane } from "./pane-spawn"
import { spawnTmuxSession } from "./session-spawn"
import { spawnTmuxWindow } from "./window-spawn"

const enabledTmuxConfig = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

type TmuxCall = readonly [command: string, args: readonly string[]]

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) throw new Error("Expected array value")
	return value.map(String)
}

function createTmuxCommandRecorder(results: readonly TmuxCommandResult[]) {
	const calls: TmuxCall[] = []
	const pendingResults = [...results]

	const runTmuxCommand = async (command: string, args: string[]): Promise<TmuxCommandResult> => {
		calls.push([command, [...args]])
		const nextResult = pendingResults.shift()
		if (!nextResult) throw new Error("No more tmux command results configured")
		return nextResult
	}

	function getCall(index: number): TmuxCall {
		const call = calls[index]
		if (!call) throw new Error(`Expected tmux runner call at index ${index}`)
		return [call[0], toStringArray(call[1])]
	}

	return { calls, getCall, runTmuxCommand }
}

function successResult(output: string = ""): TmuxCommandResult {
	return { success: true, output, stdout: output, stderr: "", exitCode: 0 }
}

function failedResult(): TmuxCommandResult {
	return { success: false, output: "", stdout: "", stderr: "", exitCode: 1 }
}

function extractEnvironment(args: readonly string[]): string[] {
	const environment: string[] = []
	for (let index = 0; index < args.length; index++) {
		if (args[index] === "-e" && args[index + 1] !== undefined) {
			environment.push(args[index + 1] as string)
			index += 1
		}
	}
	return environment
}

function createAccess(overrides: Partial<TmuxServerAccess> = {}): TmuxServerAccess {
	return {
		serverUrl: "http://127.0.0.1:4321",
		checkServerHealth: async () => true,
		getPaneEnvironment: () => ({}),
		...overrides,
	}
}

describe("tmux pane environment capabilities", () => {
	it("#given an unordered pane environment #when tmux arguments are built #then names are deterministic", () => {
		expect(buildTmuxEnvironmentArgs({ ZETA: "last", ALPHA: "first", MIDDLE: "middle" })).toEqual([
			"-e", "ALPHA=first",
			"-e", "MIDDLE=middle",
			"-e", "ZETA=last",
		])
	})

	it("#given a server capability #when every pane lifecycle path runs #then its lazy environment reaches each mutation", async () => {
		// given
		let environmentReads = 0
		let healthChecks = 0
		const access = createAccess({
			serverUrl: "http://127.0.0.1:4321/path with spaces",
			checkServerHealth: async () => {
				healthChecks += 1
				return true
			},
			getPaneEnvironment: () => {
				environmentReads += 1
				return { ZETA: "last value", ALPHA: "first value" }
			},
		})
		const paneRecorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])
		const windowRecorder = createTmuxCommandRecorder([successResult("%window"), successResult()])
		const newSessionRecorder = createTmuxCommandRecorder([failedResult(), successResult("%session"), successResult()])
		const existingSessionRecorder = createTmuxCommandRecorder([successResult(), successResult("%existing"), successResult()])
		const replaceRecorder = createTmuxCommandRecorder([successResult(), successResult(), successResult()])
		const activateRecorder = createTmuxCommandRecorder([successResult()])
		const spawnDeps = (recorder: ReturnType<typeof createTmuxCommandRecorder>) => ({
			log: () => undefined,
			runTmuxCommand: recorder.runTmuxCommand,
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
		})

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, access, "/tmp/project", "%target", "-h", spawnDeps(paneRecorder))
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, access, "/tmp/project", spawnDeps(windowRecorder))
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, access, "/tmp/project", undefined, spawnDeps(newSessionRecorder))
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, access, "/tmp/project", undefined, spawnDeps(existingSessionRecorder))
		await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, access, "/tmp/project", spawnDeps(replaceRecorder))
		await activateTmuxPane("%42", "session with spaces", access, "/tmp/project with spaces", spawnDeps(activateRecorder))

		// then
		const mutationArgs = [
			paneRecorder.getCall(0)[1],
			windowRecorder.getCall(0)[1],
			newSessionRecorder.getCall(1)[1],
			existingSessionRecorder.getCall(1)[1],
			replaceRecorder.getCall(1)[1],
			activateRecorder.getCall(0)[1],
		]
		for (const args of mutationArgs) {
			expect(extractEnvironment(args)).toEqual(["ALPHA=first value", "ZETA=last value"])
		}
		expect(environmentReads).toBe(6)
		expect(healthChecks).toBe(4)
		expect(activateRecorder.getCall(0)[1].at(-1)).toBe(
			`/bin/sh -c "opencode attach 'http://127.0.0.1:4321/path with spaces' --session 'session with spaces' --dir '/tmp/project with spaces'"`,
		)
	})

	it("#given a rejected bound health check #when a pane spawn stops early #then its environment stays lazy", async () => {
		// given
		let environmentReads = 0
		const recorder = createTmuxCommandRecorder([])
		const access = createAccess({
			checkServerHealth: async () => false,
			getPaneEnvironment: () => {
				environmentReads += 1
				return { SHOULD_NOT_BE_READ: "fixture" }
			},
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, access, "/tmp", undefined, "-h", {
			log: () => undefined,
			runTmuxCommand: recorder.runTmuxCommand,
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
		})

		// then
		expect(result).toEqual({ success: false })
		expect(environmentReads).toBe(0)
		expect(recorder.calls).toHaveLength(0)
	})

	it("#given a capability and an explicit health dependency #when a pane spawns #then the explicit dependency takes precedence", async () => {
		// given
		let boundChecks = 0
		const overriddenUrls: string[] = []
		const recorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])
		const access = createAccess({
			checkServerHealth: async () => {
				boundChecks += 1
				return false
			},
		})

		// when
		const result = await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, access, "/tmp", undefined, "-h", {
			log: () => undefined,
			runTmuxCommand: recorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async (serverUrl) => {
				overriddenUrls.push(serverUrl)
				return true
			},
			getTmuxPath: async () => "tmux",
		})

		// then
		expect(result.success).toBe(true)
		expect(boundChecks).toBe(0)
		expect(overriddenUrls).toEqual([access.serverUrl])
	})

	it("#given only raw server URLs and an ambient variable #when lifecycle paths mutate panes #then no environment is propagated", async () => {
		// given
		const ambientName = "TMUX_CORE_AMBIENT_SECRET"
		const originalAmbientValue = process.env[ambientName]
		process.env[ambientName] = "ambient-value-fixture"
		const serverUrl = "http://127.0.0.1:4321/synthetic"
		const paneRecorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])
		const windowRecorder = createTmuxCommandRecorder([successResult("%window"), successResult()])
		const sessionRecorder = createTmuxCommandRecorder([failedResult(), successResult("%session"), successResult()])
		const replaceRecorder = createTmuxCommandRecorder([successResult(), successResult(), successResult()])
		const activateRecorder = createTmuxCommandRecorder([successResult()])
		const spawnDeps = (recorder: ReturnType<typeof createTmuxCommandRecorder>) => ({
			log: () => undefined,
			runTmuxCommand: recorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})

		try {
			// when
			await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, serverUrl, "/tmp", undefined, "-h", spawnDeps(paneRecorder))
			await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, serverUrl, "/tmp", spawnDeps(windowRecorder))
			await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, serverUrl, "/tmp", undefined, spawnDeps(sessionRecorder))
			await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, serverUrl, "/tmp", spawnDeps(replaceRecorder))
			await activateTmuxPane("%42", "session-1", serverUrl, "/tmp", spawnDeps(activateRecorder))

			// then
			const mutationArgs = [
				paneRecorder.getCall(0)[1],
				windowRecorder.getCall(0)[1],
				sessionRecorder.getCall(1)[1],
				replaceRecorder.getCall(1)[1],
				activateRecorder.getCall(0)[1],
			]
			for (const args of mutationArgs) {
				expect(extractEnvironment(args)).toEqual([])
				expect(args).not.toContain(`${ambientName}=ambient-value-fixture`)
			}
		} finally {
			if (originalAmbientValue === undefined) delete process.env[ambientName]
			else process.env[ambientName] = originalAmbientValue
		}
	})
})
