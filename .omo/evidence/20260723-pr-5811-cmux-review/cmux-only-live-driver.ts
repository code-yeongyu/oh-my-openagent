import assert from "node:assert/strict"

import type { TmuxCommandResult } from "../../../packages/tmux-core/src/runner"
import type { TmuxConfig } from "../../../packages/tmux-core/src/types"
import {
	isInsideTmux,
	isTmuxPaneCompatible,
} from "../../../packages/tmux-core/src/tmux-utils/environment"
import { closeTmuxPaneWithDependencies } from "../../../packages/tmux-core/src/tmux-utils/pane-close"
import { spawnTmuxPane } from "../../../packages/omo-opencode/src/shared/tmux/tmux-utils/pane-spawn"

const config = {
	enabled: true,
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 120,
	agent_pane_min_width: 40,
	isolation: "inline",
} satisfies TmuxConfig

const originalTmux = process.env.TMUX
const originalTmuxPane = process.env.TMUX_PANE
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH
const originalUsername = process.env.OPENCODE_SERVER_USERNAME
const originalPassword = process.env.OPENCODE_SERVER_PASSWORD
const commands: string[][] = []

const runTmuxCommand = async (
	_tmuxPath: string,
	args: string[],
): Promise<TmuxCommandResult> => {
	commands.push(args)
	const output = args[0] === "split-window" ? "%42" : ""
	return {
		success: true,
		output,
		stdout: output,
		stderr: "",
		exitCode: 0,
	}
}

try {
	delete process.env.TMUX
	process.env.TMUX_PANE = "%0"
	process.env.CMUX_SOCKET_PATH = "/tmp/ulw-cmux-only.sock"

	assert.equal(isInsideTmux(), false, "cmux must not pretend to be literal tmux")
	assert.equal(isTmuxPaneCompatible(), true, "cmux inline pane environment must be eligible")

	const spawned = await spawnTmuxPane(
		"session-cmux-only",
		"qa-worker",
		config,
		"http://127.0.0.1:4096",
		"/tmp/omo project",
		"%0",
		"-h",
		{
			runTmuxCommand,
			isServerRunning: async () => true,
			getTmuxPath: async () => "/opt/homebrew/bin/tmux",
		},
	)

	assert.deepEqual(spawned, { success: true, paneId: "%42" })
	const splitWindow = commands.find((args) => args[0] === "split-window")
	assert.ok(splitWindow, "split-window command must be executed")
	const initialCommand = splitWindow.at(-1) ?? ""
	assert.match(initialCommand, /opencode attach/)
	assert.doesNotMatch(initialCommand, /Focus this pane to attach/)

	const closed = await closeTmuxPaneWithDependencies("%42", {
		isInsideTmux: isTmuxPaneCompatible,
		getTmuxPath: async () => "/opt/homebrew/bin/tmux",
		runTmuxCommand,
		log: () => undefined,
		delay: async () => undefined,
	})

	assert.equal(closed, true)
	assert.ok(commands.some((args) => args.join(" ") === "send-keys -t %42 C-c"))
	assert.ok(commands.some((args) => args.join(" ") === "kill-pane -t %42"))

	process.env.OPENCODE_SERVER_USERNAME = "$(touch /tmp/omo-cmux-user-injected)"
	process.env.OPENCODE_SERVER_PASSWORD = "$(touch /tmp/omo-cmux-password-injected)"
	const commandCountBeforeAuthenticatedSpawn = commands.length
	const authenticatedSpawn = await spawnTmuxPane(
		"session-cmux-auth",
		"qa-worker",
		config,
		"http://127.0.0.1:4096",
		"/tmp/omo project",
		"%0",
		"-h",
		{
			runTmuxCommand,
			isServerRunning: async () => true,
			getTmuxPath: async () => "/opt/homebrew/bin/tmux",
		},
	)
	assert.deepEqual(authenticatedSpawn, { success: false })
	assert.equal(commands.length, commandCountBeforeAuthenticatedSpawn)

	console.log(JSON.stringify({
		environment: {
			TMUX: process.env.TMUX ?? null,
			TMUX_PANE: process.env.TMUX_PANE,
			CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH,
		},
		insideTmux: false,
		paneCompatible: true,
		spawned,
		initialCommand,
		closed,
		authenticatedSpawn,
		authenticatedCredentialsReachedRunner: false,
		commands,
	}, null, 2))
} finally {
	if (originalTmux === undefined) {
		delete process.env.TMUX
	} else {
		process.env.TMUX = originalTmux
	}
	if (originalTmuxPane === undefined) {
		delete process.env.TMUX_PANE
	} else {
		process.env.TMUX_PANE = originalTmuxPane
	}
	if (originalCmuxSocketPath === undefined) {
		delete process.env.CMUX_SOCKET_PATH
	} else {
		process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
	}
	if (originalUsername === undefined) {
		delete process.env.OPENCODE_SERVER_USERNAME
	} else {
		process.env.OPENCODE_SERVER_USERNAME = originalUsername
	}
	if (originalPassword === undefined) {
		delete process.env.OPENCODE_SERVER_PASSWORD
	} else {
		process.env.OPENCODE_SERVER_PASSWORD = originalPassword
	}
}
