import { afterEach, beforeEach, describe, expect, it } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import type { TmuxConfig } from "../types"
import { activateTmuxPane } from "./pane-activate"
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

let originalPassword: string | undefined
let originalUsername: string | undefined

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

function createTmuxCommandRecorder(results: readonly TmuxCommandResult[]) {
	const calls: TmuxCall[] = []
	const pendingResults = [...results]

	const runTmuxCommand = async (command: string, args: string[]): Promise<TmuxCommandResult> => {
		calls.push([command, [...args]])
		const nextResult = pendingResults.shift()
		if (!nextResult) {
			throw new Error("No more tmux command results configured")
		}
		return nextResult
	}

	function getCall(index: number): TmuxCall {
		const call = calls[index]
		if (!call) {
			throw new Error(`Expected tmux runner call at index ${index}`)
		}
		return [call[0], toStringArray(call[1])]
	}

	return { runTmuxCommand, getCall }
}

function successResult(output: string = ""): TmuxCommandResult {
	return { success: true, output, stdout: output, stderr: "", exitCode: 0 }
}

function failedResult(): TmuxCommandResult {
	return { success: false, output: "", stdout: "", stderr: "", exitCode: 1 }
}

function setAuthEnv(password?: string, username?: string): void {
	if (password === undefined) {
		delete process.env.OPENCODE_SERVER_PASSWORD
	} else {
		process.env.OPENCODE_SERVER_PASSWORD = password
	}

	if (username === undefined) {
		delete process.env.OPENCODE_SERVER_USERNAME
	} else {
		process.env.OPENCODE_SERVER_USERNAME = username
	}
}

function expectAuthEnvArgs(args: readonly string[]): void {
	expect(args).toContain("-e")
	expect(args).toContain("OPENCODE_SERVER_PASSWORD=pa ss word")
	expect(args).toContain("OPENCODE_SERVER_USERNAME=user name")
}

function expectNoAuthEnvArgs(args: readonly string[]): void {
	expect(args).not.toContain("-e")
	expect(args.some((arg) => arg.startsWith("OPENCODE_SERVER_PASSWORD="))).toBe(false)
	expect(args.some((arg) => arg.startsWith("OPENCODE_SERVER_USERNAME="))).toBe(false)
}

describe("tmux pane auth environment propagation", () => {
	beforeEach(() => {
		originalPassword = process.env.OPENCODE_SERVER_PASSWORD
		originalUsername = process.env.OPENCODE_SERVER_USERNAME
	})

	afterEach(() => {
		setAuthEnv(originalPassword, originalUsername)
	})

	it("#given auth env vars with spaces #when activateTmuxPane respawns attach #then tmux receives env args and quoted attach values", async () => {
		// given
		setAuthEnv("pa ss word", "user name")
		const recorder = createTmuxCommandRecorder([successResult()])

		// when
		await activateTmuxPane("%42", "session with spaces", "http://127.0.0.1:4321/path with spaces", "/tmp/project with spaces", {
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
			runTmuxCommand: recorder.runTmuxCommand,
			log: () => undefined,
		})

		// then
		const args = recorder.getCall(0)[1]
		expect(args.slice(0, 2)).toEqual(["respawn-pane", "-k"])
		expectAuthEnvArgs(args)
		expect(args.at(-1)).toBe(
			`/bin/sh -c "opencode attach 'http://127.0.0.1:4321/path with spaces' --session 'session with spaces' --dir '/tmp/project with spaces'"`,
		)
	})

	it("#given auth env vars #when pane lifecycle commands spawn or respawn #then every tmux call site receives env args", async () => {
		// given
		setAuthEnv("pa ss word", "user name")
		const paneRecorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])
		const windowRecorder = createTmuxCommandRecorder([successResult("%window"), successResult()])
		const sessionRecorder = createTmuxCommandRecorder([successResult("120,40"), failedResult(), successResult("%session"), successResult()])
		const existingSessionRecorder = createTmuxCommandRecorder([failedResult(), successResult("%existing"), successResult()])
		const replaceRecorder = createTmuxCommandRecorder([successResult(), successResult(), successResult()])

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", "%target", "-h", {
			log: () => undefined,
			runTmuxCommand: paneRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})
		await spawnTmuxWindow("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", {
			log: () => undefined,
			runTmuxCommand: windowRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", "%source", {
			log: () => undefined,
			runTmuxCommand: sessionRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})
		await spawnTmuxSession("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", undefined, {
			log: () => undefined,
			runTmuxCommand: existingSessionRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})
		await replaceTmuxPane("%42", "session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", {
			log: () => undefined,
			runTmuxCommand: replaceRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			getTmuxPath: async () => "tmux",
		})

		// then
		expectAuthEnvArgs(paneRecorder.getCall(0)[1])
		expectAuthEnvArgs(windowRecorder.getCall(0)[1])
		expectAuthEnvArgs(sessionRecorder.getCall(2)[1])
		expectAuthEnvArgs(existingSessionRecorder.getCall(1)[1])
		expectAuthEnvArgs(replaceRecorder.getCall(1)[1])
	})

	it("#given auth env vars are unset #when pane lifecycle commands spawn #then tmux receives no auth env args", async () => {
		// given
		setAuthEnv()
		const paneRecorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", undefined, "-h", {
			log: () => undefined,
			runTmuxCommand: paneRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})

		// then
		expectNoAuthEnvArgs(paneRecorder.getCall(0)[1])
	})

	it("#given password-only auth #when a pane spawns #then tmux receives the password without a username", async () => {
		// given
		const password = "password-only-fixture"
		setAuthEnv(password)
		const paneRecorder = createTmuxCommandRecorder([successResult("%pane"), successResult()])

		// when
		await spawnTmuxPane("session-1", "worker", enabledTmuxConfig, "http://127.0.0.1:4321", "/tmp/project", undefined, "-h", {
			log: () => undefined,
			runTmuxCommand: paneRecorder.runTmuxCommand,
			isInsideTmux: () => true,
			isServerRunning: async () => true,
			getTmuxPath: async () => "tmux",
		})

		// then
		const args = paneRecorder.getCall(0)[1]
		expect(args.some((arg) => arg === `OPENCODE_SERVER_PASSWORD=${password}`)).toBe(true)
		expect(args.some((arg) => arg.startsWith("OPENCODE_SERVER_USERNAME="))).toBe(false)
	})
})
