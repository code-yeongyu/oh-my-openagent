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
const originalHarnessIdentity = process.env.HARNESS_IDENTITY
const originalHarnessSecret = process.env.HARNESS_SECRET

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
		HARNESS_IDENTITY: "identity-fixture",
		HARNESS_SECRET: "secret-fixture",
	}),
} satisfies TmuxServerAccess

const clearedServerAccess = {
	serverUrl: "http://127.0.0.1:4096",
	checkServerHealth: async () => true,
	getPaneEnvironment: () => ({
		HARNESS_IDENTITY: "",
		HARNESS_SECRET: "",
	}),
} satisfies TmuxServerAccess

function switchToNativeTmux(): void {
	process.env.TMUX = "/tmp/tmux-native.sock,1234,0"
	delete process.env.CMUX_SOCKET_PATH
	delete process.env.HARNESS_IDENTITY
	delete process.env.HARNESS_SECRET
}

function switchToAuthenticatedCmux(): void {
	process.env.TMUX = "/tmp/cmuxterm-test.sock,1234,0"
	process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
	process.env.HARNESS_SECRET = "late-ambient-secret-fixture"
}

function resultForCommand(command: string): TmuxCommandResult {
	if (command === "has-session") {
		return { success: false, output: "", stdout: "", stderr: "", exitCode: 1 }
	}
	const output = ["split-window", "new-window", "new-session", "respawn-pane"].includes(command) ? "%42" : ""
	return { success: true, output, stdout: output, stderr: "", exitCode: 0 }
}

function restoreEnvironment(): void {
	if (originalTmux === undefined) delete process.env.TMUX
	else process.env.TMUX = originalTmux
	if (originalCmuxSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH
	else process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
	if (originalHarnessIdentity === undefined) delete process.env.HARNESS_IDENTITY
	else process.env.HARNESS_IDENTITY = originalHarnessIdentity
	if (originalHarnessSecret === undefined) delete process.env.HARNESS_SECRET
	else process.env.HARNESS_SECRET = originalHarnessSecret
}

describe("cmux authenticated pane lifecycle", () => {
	beforeEach(() => {
		delete process.env.TMUX
		process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
		delete process.env.HARNESS_IDENTITY
		delete process.env.HARNESS_SECRET
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
		process.env.HARNESS_SECRET = "ambient-secret-fixture"
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

	test("#given a raw URL #when spawning under cmux #then generic empty environment is safely omitted", async () => {
		// given
		const runTmuxCommand = mock(async (_command: string, _args: string[]): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-raw-anonymous",
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
		expect(runTmuxCommand.mock.calls[0]?.[1]).not.toContain("-e")
	})

	test("#given cmux appears while resolving tmux #when spawning a pane #then the late environment is rejected before the runner", async () => {
		switchToNativeTmux()
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		const result = await spawnTmuxPane(
			"session-cmux-late-pane",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			"%0",
			"-h",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				isCmuxCompatEnvironment: () => process.env.CMUX_SOCKET_PATH !== undefined,
				getTmuxPath: async () => {
					switchToAuthenticatedCmux()
					return "cmux"
				},
				log: mock(() => undefined),
			},
		)

		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given cmux appears while resolving tmux #when activating a pane #then the late environment is rejected before respawn", async () => {
		switchToNativeTmux()
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		const result = await activateTmuxPane(
			"%42",
			"session-cmux-late-activate",
			clearedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => {
					switchToAuthenticatedCmux()
					return "cmux"
				},
				log: mock(() => undefined),
			},
		)

		expect(result).toBe(false)
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given cmux appears while resolving tmux #when replacing a pane #then the late environment is rejected before shutdown", async () => {
		switchToNativeTmux()
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		const result = await replaceTmuxPane(
			"%42",
			"session-cmux-late-replace",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => {
					switchToAuthenticatedCmux()
					return "cmux"
				},
				log: mock(() => undefined),
			},
		)

		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given cmux appears while resolving tmux #when spawning a window #then the late environment is rejected before creation", async () => {
		switchToNativeTmux()
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		const result = await spawnTmuxWindow(
			"session-cmux-late-window",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => {
					switchToAuthenticatedCmux()
					return "cmux"
				},
				log: mock(() => undefined),
			},
		)

		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given cmux appears while resolving tmux #when spawning a session #then preparatory commands cannot inherit the late environment", async () => {
		switchToNativeTmux()
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		const result = await spawnTmuxSession(
			"session-cmux-late-session",
			"worker",
			config,
			clearedServerAccess,
			"/tmp/project",
			"%0",
			{
				runTmuxCommand,
				isInsideTmux: () => true,
				getTmuxPath: async () => {
					switchToAuthenticatedCmux()
					return "cmux"
				},
				log: mock(() => undefined),
			},
		)

		expect(result).toEqual({ success: false })
		expect(runTmuxCommand).not.toHaveBeenCalled()
	})

	test("#given authenticated cmux appears after pane creation #when lifecycle paths set titles #then no title runner inherits it", async () => {
		const exercise = async (
			mutationCommand: string,
			action: (
				runTmuxCommand: (command: string, args: string[]) => Promise<TmuxCommandResult>,
				log: (message: string, data?: unknown) => void,
			) => Promise<unknown>,
		) => {
			switchToNativeTmux()
			const calls: string[] = []
			const log = mock((_message: string, _data?: unknown) => undefined)
			const runTmuxCommand = mock(async (_command: string, args: string[]): Promise<TmuxCommandResult> => {
				const command = args[0] ?? ""
				calls.push(command)
				if (command === mutationCommand) switchToAuthenticatedCmux()
				return resultForCommand(command)
			})

			await action(runTmuxCommand, log)

			expect(calls).toContain(mutationCommand)
			expect(calls).not.toContain("select-pane")
			expect(log.mock.calls.some((call) =>
				(call[1] as { stderr?: string } | undefined)?.stderr ===
					"tmux backend no longer matches the resolved executable"
			)).toBe(true)
		}

		await exercise("split-window", (runTmuxCommand, log) =>
			spawnTmuxPane(
				"session-late-title-pane",
				"worker",
				config,
				clearedServerAccess,
				"/tmp/project",
				"%0",
				"-h",
				{
					runTmuxCommand,
					isInsideTmux: () => true,
					isCmuxCompatEnvironment: () => process.env.TMUX?.includes("cmuxterm") === true,
					getTmuxPath: async () => "tmux",
					log,
				},
			))

		await exercise("new-window", (runTmuxCommand, log) =>
			spawnTmuxWindow(
				"session-late-title-window",
				"worker",
				config,
				clearedServerAccess,
				"/tmp/project",
				{
					runTmuxCommand,
					isInsideTmux: () => true,
					getTmuxPath: async () => "tmux",
					log,
				},
			))

		await exercise("new-session", (runTmuxCommand, log) =>
			spawnTmuxSession(
				"session-late-title-session",
				"worker",
				config,
				clearedServerAccess,
				"/tmp/project",
				undefined,
				{
					runTmuxCommand,
					isInsideTmux: () => true,
					getTmuxPath: async () => "tmux",
					log,
				},
			))

		await exercise("respawn-pane", (runTmuxCommand, log) =>
			replaceTmuxPane(
				"%42",
				"session-late-title-replace",
				"worker",
				config,
				clearedServerAccess,
				"/tmp/project",
				{
					runTmuxCommand,
					isInsideTmux: () => true,
					getTmuxPath: async () => "tmux",
					log,
				},
			))
	})
})
