import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import type { TmuxConfig, TmuxServerAccess } from "../types"
import { activateTmuxPane } from "./pane-activate"
import { replaceTmuxPane } from "./pane-replace"
import { spawnTmuxSession } from "./session-spawn"
import { spawnTmuxPane } from "./pane-spawn"
import { spawnTmuxWindow } from "./window-spawn"

const originalTmux = process.env.TMUX
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
const originalUsername = process.env.OPENCODE_SERVER_USERNAME
const originalPassword = process.env.OPENCODE_SERVER_PASSWORD

const config = {
	enabled: true,
	isolation: "inline",
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 80,
	agent_pane_min_width: 40,
} satisfies TmuxConfig

const commandResult = {
	success: true,
	output: "%42",
	stdout: "%42",
	stderr: "",
	exitCode: 0,
} satisfies TmuxCommandResult

const authenticatedServerAccess = {
	serverUrl: "http://127.0.0.1:4096",
	checkServerHealth: async () => true,
	getPaneEnvironment: () => ({
		OPENCODE_SERVER_USERNAME: "username-fixture",
		OPENCODE_SERVER_PASSWORD: "password-fixture",
	}),
} satisfies TmuxServerAccess

const clearedServerAccess = {
	serverUrl: "http://127.0.0.1:4096",
	checkServerHealth: async () => true,
	getPaneEnvironment: () => ({
		OPENCODE_SERVER_USERNAME: "",
		OPENCODE_SERVER_PASSWORD: "",
	}),
} satisfies TmuxServerAccess

function restoreEnvironment(): void {
	if (originalTmux === undefined) delete process.env.TMUX
	else process.env.TMUX = originalTmux
	if (originalCmuxSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH
	else process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
	if (originalUsername === undefined) delete process.env.OPENCODE_SERVER_USERNAME
	else process.env.OPENCODE_SERVER_USERNAME = originalUsername
	if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
	else process.env.OPENCODE_SERVER_PASSWORD = originalPassword
}

describe("cmux authenticated pane lifecycle", () => {
	beforeEach(() => {
		delete process.env.TMUX
		process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
		delete process.env.OPENCODE_SERVER_USERNAME
		delete process.env.OPENCODE_SERVER_PASSWORD
	})

	afterEach(() => {
		restoreEnvironment()
	})

	test("#given authenticated cmux #when spawning a pane #then fails before credentials reach the command runner", async () => {
		// given
		const runTmuxCommand = mock(async (_command: string, _args: string[]): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-auth",
			"worker",
			config,
			authenticatedServerAccess,
			"/tmp/project",
			"%0",
			"-h",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				isCmuxCompatEnvironment: () => true,
				isServerRunning: async () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given authenticated cmux #when activating a pane #then fails before credentials reach the command runner", async () => {
		// given
		const runTmuxCommand = mock(async (_command: string, _args: string[]): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await activateTmuxPane(
			"%42",
			"session-cmux-auth",
			authenticatedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toBe(false)
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given authenticated cmux #when replacing a pane #then fails before credentials reach the command runner", async () => {
		// given
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await replaceTmuxPane(
			"%42",
			"session-cmux-auth",
			"worker",
			config,
			authenticatedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given authenticated cmux with fake TMUX #when spawning a window #then fails before credentials reach the command runner", async () => {
		// given
		process.env.TMUX = "/tmp/cmuxterm-test.sock,1234,0"
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxWindow(
			"session-cmux-auth",
			"worker",
			config,
			authenticatedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				isServerRunning: async () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given authenticated cmux with fake TMUX #when spawning a session #then fails before credentials reach the command runner", async () => {
		// given
		process.env.TMUX = "/tmp/cmuxterm-test.sock,1234,0"
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxSession(
			"session-cmux-auth",
			"worker",
			config,
			authenticatedServerAccess,
			"/tmp/project",
			"%0",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				isServerRunning: async () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given cleared credentials and no ambient values #when spawning under cmux #then omission is safe", async () => {
		// given
		const runTmuxCommand = mock(async (_command: string, _args: string[]): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-anonymous",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			"%0",
			"-h",
			{
				runTmuxCommand,
				isInsideTmux: () => false,
				isCmuxCompatEnvironment: () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: true, paneId: "%42" })
		expect(runTmuxCommand).toHaveBeenCalledTimes(2)
		expect(runTmuxCommand.mock.calls[0]?.[1]).not.toContain("-e")
	})

	test("#given cleared credentials with an ambient value #when spawning under cmux #then failure prevents inheritance", async () => {
		// given
		process.env.OPENCODE_SERVER_PASSWORD = "ambient-password-fixture"
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-ambient",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			"%0",
			"-h",
			{
				runTmuxCommand,
				isInsideTmux: () => false,
				isCmuxCompatEnvironment: () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given a raw URL and ambient credentials #when spawning under cmux #then ambient values are not absorbed", async () => {
		// given
		process.env.OPENCODE_SERVER_USERNAME = "ambient-username-fixture"
		process.env.OPENCODE_SERVER_PASSWORD = "ambient-password-fixture"
		const runTmuxCommand = mock(async (_command: string, _args: string[]): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-raw",
			"worker",
			config,
			"http://127.0.0.1:4096",
			"/tmp/project",
			"%0",
			"-h",
			{
				runTmuxCommand,
				isInsideTmux: () => false,
				isCmuxCompatEnvironment: () => true,
				isServerRunning: async () => true,
				getTmuxPath: async () => "cmux",
				log: mock(() => undefined),
			},
		)

		// then
		expect(result).toEqual({ success: true, paneId: "%42" })
		const args = runTmuxCommand.mock.calls[0]?.[1] ?? []
		expect(args).not.toContain("-e")
		expect(args.some((arg) => arg.includes("ambient-username-fixture") || arg.includes("ambient-password-fixture"))).toBe(false)
	})
})
