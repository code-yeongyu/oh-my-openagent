/// <reference types="bun-types" />

import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { spawn } from "bun"

const LIVE = process.env.OMO_LIVE_TMUX === "1"
const HOSTNAME = "127.0.0.1"
const layoutSpecifier = import.meta.resolve("./layout")

type TeamLayoutMemberLike = {
	name: string
	sessionId: string
	worktreePath?: string
}

type TmuxManagerLike = {
	getServerUrl: () => string
}

type TeamLayoutResultLike = {
	focusWindowId: string
	gridWindowId?: string
	focusPanesByMember: Record<string, string>
	gridPanesByMember: Record<string, string>
	targetSessionId: string
	ownedSession: boolean
}

type LoadedLayoutModule = {
	createTeamLayout?: unknown
	removeTeamLayout?: unknown
}

type TmuxCommandResult = {
	success: boolean
	stdout: string
	stderr: string
	exitCode: number
}

type TmuxWindow = {
	id: string
	name: string
}

type LiveTestState = {
	callerPaneId: string
	callerSessionId: string
	callerSessionName: string
	healthServer: ReturnType<typeof Bun.serve>
	originalTmux: string | undefined
	originalTmuxPane: string | undefined
	socketPath: string
	tempRoot: string
	tmuxManager: TmuxManagerLike
}

let liveTestState: LiveTestState | null = null

function requireLiveTestState(): LiveTestState {
	if (liveTestState === null) {
		throw new Error("live tmux smoke test state was not initialized")
	}

	return liveTestState
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object"
}

function isTeamLayoutResultLike(value: unknown): value is TeamLayoutResultLike {
	if (!isRecord(value)) {
		return false
	}

	return typeof value.focusWindowId === "string"
		&& (value.gridWindowId === undefined || typeof value.gridWindowId === "string")
		&& isRecord(value.focusPanesByMember)
		&& isRecord(value.gridPanesByMember)
		&& typeof value.targetSessionId === "string"
		&& typeof value.ownedSession === "boolean"
}

async function runTmuxCommand(args: string[]): Promise<TmuxCommandResult> {
	const subprocess = spawn(["tmux", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	})

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(subprocess.stdout).text(),
		new Response(subprocess.stderr).text(),
		subprocess.exited,
	])

	return {
		success: exitCode === 0,
		stdout: stdout.trim(),
		stderr: stderr.trim(),
		exitCode,
	}
}

async function createCallerSession(sessionName: string): Promise<{ callerSessionId: string; callerPaneId: string; socketPath: string }> {
	const createdSession = await runTmuxCommand([
		"new-session",
		"-d",
		"-s",
		sessionName,
		"-P",
		"-F",
		"#{session_id} #{pane_id}",
	])

	if (!createdSession.success) {
		throw new Error(`failed to create caller tmux session: ${createdSession.stderr || createdSession.stdout}`)
	}

	const [callerSessionId, callerPaneId] = createdSession.stdout.split(" ", 2)
	if (!callerSessionId || !callerPaneId) {
		throw new Error(`failed to parse caller session identifiers: ${createdSession.stdout}`)
	}

	const socketPathResult = await runTmuxCommand(["display-message", "-p", "-t", callerPaneId, "#{socket_path}"])
	if (!socketPathResult.success || socketPathResult.stdout.length === 0) {
		throw new Error(`failed to resolve tmux socket path: ${socketPathResult.stderr || socketPathResult.stdout}`)
	}

	return { callerSessionId, callerPaneId, socketPath: socketPathResult.stdout }
}

async function listWindows(sessionId: string): Promise<TmuxWindow[]> {
	const listedWindows = await runTmuxCommand(["list-windows", "-t", sessionId, "-F", "#{window_id}\t#{window_name}"])
	if (!listedWindows.success) {
		throw new Error(`failed to list tmux windows: ${listedWindows.stderr || listedWindows.stdout}`)
	}

	return listedWindows.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => {
			const [id, name] = line.split("\t", 2)
			if (!id || !name) {
				throw new Error(`failed to parse tmux window line: ${line}`)
			}

			return { id, name }
		})
}

async function waitForCondition(predicate: () => Promise<boolean>): Promise<boolean> {
	for (let attempt = 0; attempt < 30; attempt += 1) {
		if (await predicate()) {
			return true
		}

		await new Promise<void>((resolve) => {
			setTimeout(resolve, 100)
		})
	}

	return false
}

async function loadLayoutModule(): Promise<LoadedLayoutModule> {
	return import(`${layoutSpecifier}?live=${Date.now()}-${Math.random()}`)
}

async function invokeCreateTeamLayout(
	layoutModule: LoadedLayoutModule,
	teamRunId: string,
	members: TeamLayoutMemberLike[],
	tmuxManager: TmuxManagerLike,
): Promise<TeamLayoutResultLike> {
	const createTeamLayout = layoutModule.createTeamLayout
	if (!(createTeamLayout instanceof Function)) {
		throw new Error("createTeamLayout export missing")
	}

	const result = await Promise.resolve(Reflect.apply(createTeamLayout, undefined, [teamRunId, members, tmuxManager]))
	if (!isTeamLayoutResultLike(result)) {
		throw new Error("createTeamLayout returned an unexpected result")
	}

	return result
}

async function invokeRemoveTeamLayout(
	layoutModule: LoadedLayoutModule,
	teamRunId: string,
	tmuxManager: TmuxManagerLike,
	layoutResult: TeamLayoutResultLike,
	targetSessionId: string,
): Promise<void> {
	const removeTeamLayout = layoutModule.removeTeamLayout
	if (!(removeTeamLayout instanceof Function)) {
		throw new Error("removeTeamLayout export missing")
	}

	await Promise.resolve(Reflect.apply(removeTeamLayout, undefined, [
		teamRunId,
		{
			ownedSession: false,
			targetSessionId,
			focusWindowId: layoutResult.focusWindowId,
			gridWindowId: layoutResult.gridWindowId,
			paneIds: Object.values(layoutResult.focusPanesByMember),
		},
		tmuxManager,
	]))
}

describe("team-mode live tmux smoke", () => {
	beforeEach(async () => {
		if (!LIVE) {
			return
		}

		const callerSessionName = `omo-smoke-${Date.now()}`
		const { callerSessionId, callerPaneId, socketPath } = await createCallerSession(callerSessionName)
		const tempRoot = path.join("/tmp", `omo-live-tmux-${randomUUID()}`)
		await mkdir(path.join(tempRoot, "lead"), { recursive: true })
		await mkdir(path.join(tempRoot, "member-two"), { recursive: true })

		const healthServer = Bun.serve({
			port: 0,
			hostname: HOSTNAME,
			fetch(request) {
				const requestUrl = new URL(request.url)
				if (requestUrl.pathname === "/global/health") {
					return new Response("ok")
				}

				return new Response("not found", { status: 404 })
			},
		})

		liveTestState = {
			callerPaneId,
			callerSessionId,
			callerSessionName,
			healthServer,
			originalTmux: process.env.TMUX,
			originalTmuxPane: process.env.TMUX_PANE,
			socketPath,
			tempRoot,
			tmuxManager: {
				getServerUrl: () => `http://${HOSTNAME}:${healthServer.port}`,
			},
		}

		process.env.TMUX = `${socketPath},0,0`
		process.env.TMUX_PANE = callerPaneId
	})

	afterEach(async () => {
		const state = liveTestState
		liveTestState = null
		if (state === null) {
			return
		}

		state.healthServer.stop(true)
		process.env.TMUX = state.originalTmux
		process.env.TMUX_PANE = state.originalTmuxPane
		await runTmuxCommand(["kill-session", "-t", state.callerSessionName])
		await rm(state.tempRoot, { recursive: true, force: true })
	})

	test.skipIf(!LIVE)("#given a real caller tmux session and two mock members #when createTeamLayout runs #then teammate panes appear in the caller window and cleanup leaves the session intact", async () => {
		// given
		const state = requireLiveTestState()
		const layoutModule = await loadLayoutModule()
		const teamRunId = randomUUID()
		const initialWindows = await listWindows(state.callerSessionId)
		const members: TeamLayoutMemberLike[] = [
			{
				name: "lead",
				sessionId: `${teamRunId}-lead`,
				worktreePath: path.join(state.tempRoot, "lead"),
			},
			{
				name: "member-two",
				sessionId: `${teamRunId}-member-two`,
				worktreePath: path.join(state.tempRoot, "member-two"),
			},
		]

		// when
		const layoutResult = await invokeCreateTeamLayout(layoutModule, teamRunId, members, state.tmuxManager)
		const panesAppeared = await waitForCondition(async () => {
			const panes = await runTmuxCommand(["list-panes", "-t", state.callerSessionId, "-F", "#{pane_id}"])
			return panes.success && Object.values(layoutResult.focusPanesByMember).every((paneId) => panes.stdout.split("\n").includes(paneId))
		})
		const windowsUnchangedBeforeCleanup = await waitForCondition(async () => {
			const windows = await listWindows(state.callerSessionId)
			return windows.map((window) => window.id).join(",") === initialWindows.map((window) => window.id).join(",")
		})

		await invokeRemoveTeamLayout(layoutModule, teamRunId, state.tmuxManager, layoutResult, state.callerSessionId)
		const panesRemoved = await waitForCondition(async () => {
			const panes = await runTmuxCommand(["list-panes", "-t", state.callerSessionId, "-F", "#{pane_id}"])
			return panes.success && Object.values(layoutResult.focusPanesByMember).every((paneId) => !panes.stdout.split("\n").includes(paneId))
		})
		const windowsUnchangedAfterCleanup = await waitForCondition(async () => {
			const windows = await listWindows(state.callerSessionId)
			return windows.map((window) => window.id).join(",") === initialWindows.map((window) => window.id).join(",")
		})
		const callerSessionStillAlive = await runTmuxCommand(["has-session", "-t", state.callerSessionId])

		// then
		expect(layoutResult.focusWindowId.length).toBeGreaterThan(0)
		expect(layoutResult.gridWindowId).toBeUndefined()
		expect(panesAppeared).toBe(true)
		expect(windowsUnchangedBeforeCleanup).toBe(true)
		expect(panesRemoved).toBe(true)
		expect(windowsUnchangedAfterCleanup).toBe(true)
		expect(callerSessionStillAlive.success).toBe(true)
		expect(process.env.TMUX_PANE).toBe(state.callerPaneId)
	})
})
