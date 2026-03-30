import { spawn } from "bun"
import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { shellEscapeForDoubleQuotedCommand } from "../../shell-env"

const ISOLATED_SESSION_NAME = "omo-agents"

async function getWindowDimensions(
	tmux: string,
	sourcePaneId: string,
): Promise<{ width: number; height: number } | null> {
	const proc = spawn(
		[tmux, "display", "-p", "-t", sourcePaneId, "#{window_width},#{window_height}"],
		{ stdout: "pipe", stderr: "pipe" },
	)
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()

	if (exitCode !== 0) return null

	const [width, height] = stdout.trim().split(",").map(Number)
	if (Number.isNaN(width) || Number.isNaN(height)) return null

	return { width, height }
}

async function sessionExists(tmux: string, sessionName: string): Promise<boolean> {
	const proc = spawn([tmux, "has-session", "-t", sessionName], {
		stdout: "ignore",
		stderr: "ignore",
	})
	return (await proc.exited) === 0
}

export async function spawnTmuxSession(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	sourcePaneId?: string,
): Promise<SpawnPaneResult> {
	const { log } = await import("../../logger")

	log("[spawnTmuxSession] called", {
		sessionId,
		description,
		serverUrl,
		configEnabled: config.enabled,
	})

	if (!config.enabled) {
		log("[spawnTmuxSession] SKIP: config.enabled is false")
		return { success: false }
	}
	if (!isInsideTmux()) {
		log("[spawnTmuxSession] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxSession] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxSession] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxSession] all checks passed, creating isolated session...")

	const shell = process.env.SHELL || "/bin/sh"
	const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
	const escapedSessionId = shellEscapeForDoubleQuotedCommand(sessionId)
	const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${escapedSessionId}"`

	const sizeArgs: string[] = []
	if (sourcePaneId) {
		const dims = await getWindowDimensions(tmux, sourcePaneId)
		if (dims) {
			sizeArgs.push("-x", String(dims.width), "-y", String(dims.height))
		}
	}

	const sessionAlreadyExists = await sessionExists(tmux, ISOLATED_SESSION_NAME)

	const args = sessionAlreadyExists
		? [
			"new-window",
			"-t", ISOLATED_SESSION_NAME,
			"-P",
			"-F", "#{pane_id}",
			opencodeCmd,
		]
		: [
			"new-session",
			"-d",
			"-s", ISOLATED_SESSION_NAME,
			...sizeArgs,
			"-P",
			"-F", "#{pane_id}",
			opencodeCmd,
		]

	log("[spawnTmuxSession] spawning", {
		mode: sessionAlreadyExists ? "new-window" : "new-session",
		sessionName: ISOLATED_SESSION_NAME,
	})

	const proc = spawn([tmux, ...args], { stdout: "pipe", stderr: "pipe" })
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()
	const paneId = stdout.trim()

	if (exitCode !== 0 || !paneId) {
		const stderr = await new Response(proc.stderr).text()
		log("[spawnTmuxSession] FAILED", { exitCode, stderr: stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleProc = spawn([tmux, "select-pane", "-t", paneId, "-T", title], {
		stdout: "ignore",
		stderr: "pipe",
	})
	const stderrPromise = new Response(titleProc.stderr).text().catch(() => "")
	const titleExitCode = await titleProc.exited
	if (titleExitCode !== 0) {
		const titleStderr = await stderrPromise
		log("[spawnTmuxSession] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleExitCode,
			stderr: titleStderr.trim(),
		})
	}

	log("[spawnTmuxSession] SUCCESS", { paneId, sessionName: ISOLATED_SESSION_NAME })
	return { success: true, paneId }
}
