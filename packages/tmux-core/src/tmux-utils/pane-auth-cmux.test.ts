import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { TmuxCommandResult } from "../runner"
import type { TmuxConfig } from "../types"
import { activateTmuxPane } from "./pane-activate"
import { replaceTmuxPane } from "./pane-replace"
import { spawnTmuxPane } from "./pane-spawn"

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
		process.env.OPENCODE_SERVER_USERNAME = "$(touch /tmp/omo-cmux-user-injected)"
		process.env.OPENCODE_SERVER_PASSWORD = "$(touch /tmp/omo-cmux-password-injected)"
	})

	afterEach(() => {
		restoreEnvironment()
	})

	test("#given authenticated cmux #when spawning a pane #then fails before credentials reach the command runner", async () => {
		// given
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await spawnTmuxPane(
			"session-cmux-auth",
			"worker",
			config,
			"http://127.0.0.1:4096",
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
		const runTmuxCommand = mock(async (): Promise<TmuxCommandResult> => commandResult)

		// when
		const result = await activateTmuxPane(
			"%42",
			"session-cmux-auth",
			"http://127.0.0.1:4096",
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
			"http://127.0.0.1:4096",
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
})
