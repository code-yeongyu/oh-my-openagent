/// <reference path="../../../../../bun-test.d.ts" />
import { afterEach, describe, expect, mock, test } from "bun:test"

import type { PluginInput } from "@opencode-ai/plugin"
import { buildTmuxAttachCommand } from "@oh-my-opencode/tmux-core"
import type { HerdrExecResult, HerdrOpsDeps, RunHerdrCommand } from "@oh-my-opencode/tmux-core"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ActionResult, ExecuteActionsResult } from "./action-executor"
import { selectTmuxManagerEnvironmentPredicate } from "./environment-eligibility"
import { TmuxSessionManager, type TmuxSessionManager as TmuxSessionManagerType, type TmuxUtilDeps } from "./manager"
import type { WindowState, PaneAction } from "./types"

/**
 * Herdr backend coverage for the subagent pane manager: spawn maps to a tab
 * in the manager's omo-agents workspace, the attach command is delivered via
 * pane run, close/dead-pane/gone-pane flows map to pane close, and cleanup
 * tears the workspace down. Everything runs against a fake runHerdrCommand
 * (argv assertions), no tmux involved.
 */

const originalTmux = process.env.TMUX
const originalTmuxPane = process.env.TMUX_PANE
const originalHerdrBinPath = process.env.HERDR_BIN_PATH

const herdrConfig = {
	enabled: true,
	isolation: "inline",
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 80,
	agent_pane_min_width: 40,
	multiplexer: "herdr",
} satisfies TmuxConfig

function envelope(result: unknown): string {
	return JSON.stringify({ id: "cli:test", result })
}

function errorEnvelope(code: string, message: string): HerdrExecResult {
	return { success: false, output: JSON.stringify({ id: "cli:test", error: { code, message } }), error: message, code }
}

type HerdrScript = (args: ReadonlyArray<string>) => HerdrExecResult

function fakeHerdrOps(script: HerdrScript): { ops: HerdrOpsDeps; calls: string[][] } {
	const calls: string[][] = []
	const run: RunHerdrCommand = async (args) => {
		calls.push([...args])
		return script(args)
	}
	return { ops: { runHerdrCommand: run, ensureServer: async () => "running" }, calls }
}

/** Script for a healthy herdr: workspace w9 with one fresh tab per create. */
function healthyHerdr(): { script: HerdrScript; state: { tabCount: number } } {
	const state = { tabCount: 0 }
	return {
		state,
		script: (args) => {
			if (args[0] === "workspace" && args[1] === "list") {
				return { success: true, output: envelope({ workspaces: [{ workspace_id: "w1", label: "wb-repricer-system-new" }] }) }
			}
			if (args[0] === "workspace" && args[1] === "create") {
				return { success: true, output: envelope({ workspace: { workspace_id: "w9" }, root_pane: { pane_id: "w9:p1" } }) }
			}
			if (args[0] === "tab" && args[1] === "create") {
				state.tabCount += 1
				return { success: true, output: envelope({ tab: { tab_id: `w9:t${state.tabCount + 1}` }, root_pane: { pane_id: `w9:p${state.tabCount + 1}` } }) }
			}
			return { success: true, output: "" }
		},
	}
}

const mockQueryWindowState = mock<(paneId: string) => Promise<WindowState | null>>(async () => null)
const mockExecuteActions = mock<(actions: PaneAction[], ctx: unknown) => Promise<ExecuteActionsResult>>(async () => ({
	success: false,
	results: [],
}))
const mockExecuteAction = mock<(action: PaneAction, ctx: unknown) => Promise<ActionResult>>(async () => ({ success: false }))
const mockWaitForSessionReady = mock<(params: { client: unknown; sessionId: string }) => Promise<boolean>>(async () => true)

function buildManager(
	ops: HerdrOpsDeps,
	client: PluginInput["client"] = unsafeTestValue<PluginInput["client"]>({
		session: { status: mock(async () => ({ data: { "sess-1": { type: "running" }, "sess-2": { type: "running" } } })) },
	}),
): TmuxSessionManager {
	const deps: Partial<TmuxUtilDeps> = {
		isInsideTmux: selectTmuxManagerEnvironmentPredicate(herdrConfig.isolation, herdrConfig.multiplexer),
		getCurrentPaneId: () => undefined,
		queryWindowState: mockQueryWindowState,
		waitForSessionReady: mockWaitForSessionReady,
		executeActions: mockExecuteActions,
		executeAction: mockExecuteAction,
		log: () => undefined,
		herdrOps: ops,
	}
	const manager = new TmuxSessionManager(
		unsafeTestValue<PluginInput>({
			directory: "/tmp/omo-project",
			serverUrl: new URL("http://127.0.0.1:4096"),
			client,
		}),
		herdrConfig,
		deps,
	)
	// keep the stale sweep out of these tests (it has its own coverage)
	unsafeTestValue<{ staleSweepCompleted: boolean }>(manager).staleSweepCompleted = true
	return manager
}

function sessionCreatedEvent(sessionId = "sess-1", title = "herdr worker") {
	return {
		type: "session.created",
		properties: { info: { id: sessionId, parentID: "parent-session", title } },
	}
}

const commandOf = (call: string[]): string => `${call[0]} ${call[1] ?? ""}`.trim()

type ManagerInternals = {
	tryAttachDeferredSession: () => Promise<void>
	retryPendingCloses: () => Promise<void>
	sessions: Map<string, { closePending: boolean }>
	staleSweepCompleted: boolean
}

const internalsOf = (manager: TmuxSessionManagerType): ManagerInternals =>
	unsafeTestValue<ManagerInternals>(manager)

afterEach(() => {
	if (originalTmux === undefined) delete process.env.TMUX
	else process.env.TMUX = originalTmux
	if (originalTmuxPane === undefined) delete process.env.TMUX_PANE
	else process.env.TMUX_PANE = originalTmuxPane
	if (originalHerdrBinPath === undefined) delete process.env.HERDR_BIN_PATH
	else process.env.HERDR_BIN_PATH = originalHerdrBinPath
	mockQueryWindowState.mockClear()
	mockExecuteActions.mockClear()
	mockExecuteAction.mockClear()
	mockWaitForSessionReady.mockClear()
})

describe("TmuxSessionManager on the herdr backend", () => {
	test("#given herdr multiplexer without tmux #when child session is created #then a tab spawns in the agents workspace with the attach command delivered via pane run", async () => {
		// given — no TMUX env at all; eligibility comes from the herdr binary
		delete process.env.TMUX
		delete process.env.TMUX_PANE
		process.env.HERDR_BIN_PATH = import.meta.path
		expect(selectTmuxManagerEnvironmentPredicate("inline", "herdr")()).toBe(true)

		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps(herdr.script)
		const manager = buildManager(ops)

		// when
		await manager.onSessionCreated(sessionCreatedEvent())

		// then — tmux surfaces are never touched
		expect(mockQueryWindowState).not.toHaveBeenCalled()
		expect(mockExecuteActions).not.toHaveBeenCalled()

		expect(manager.getTrackedPaneId("sess-1")).toBe("w9:p2")

		const workspaceCreate = calls.find((call) => commandOf(call) === "workspace create")
		expect(workspaceCreate).toBeDefined()
		// the workspace label mirrors the tmux isolated-session grammar
		expect(workspaceCreate?.[workspaceCreate.length - 2]).toMatch(/^omo-agents-\d+(-\d+)?$/)

		const tabCreate = calls.find((call) => commandOf(call) === "tab create")
		expect(tabCreate?.[3]).toBe("w9")
		expect(tabCreate?.[7]).toBe("herdr worker")

		const paneRun = calls.find((call) => commandOf(call) === "pane run")
		expect(paneRun?.slice(0, 3)).toEqual(["pane", "run", "w9:p2"])
		// ctx.serverUrl normalizes to a trailing slash before reaching the pane
		expect(paneRun?.[3]).toBe(buildTmuxAttachCommand("http://127.0.0.1:4096/", "sess-1", "/tmp/omo-project"))
		expect(paneRun?.[3]).toContain("opencode attach")

		await manager.cleanup()
	})

	test("#given an existing tracked pane #when a second subagent spawns #then the workspace is reused without a second create", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps(herdr.script)
		const manager = buildManager(ops)

		await manager.onSessionCreated(sessionCreatedEvent("sess-1", "first worker"))
		await manager.onSessionCreated(sessionCreatedEvent("sess-2", "second worker"))

		expect(manager.getTrackedPaneId("sess-1")).toBe("w9:p2")
		expect(manager.getTrackedPaneId("sess-2")).toBe("w9:p3")
		// one workspace create for the whole manager lifetime
		expect(calls.filter((call) => commandOf(call) === "workspace create")).toHaveLength(1)
		const tabCreates = calls.filter((call) => commandOf(call) === "tab create")
		expect(tabCreates).toHaveLength(2)
		expect(tabCreates.every((call) => call[3] === "w9")).toBe(true)

		await manager.cleanup()
	})

	test("#given tab creation fails #when child session is created #then the session is deferred and later attaches through the herdr path", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		let failing = true
		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps((args) => {
			if (failing && args[0] === "tab" && args[1] === "create") {
				return errorEnvelope("spawn_failed", "tab rejected")
			}
			return herdr.script(args)
		})
		const manager = buildManager(ops)

		await manager.onSessionCreated(sessionCreatedEvent())
		expect(manager.getTrackedPaneId("sess-1")).toBeUndefined()

		// the deferred retry loop re-enters the herdr spawn path once herdr recovers
		failing = false
		await internalsOf(manager).tryAttachDeferredSession()

		expect(manager.getTrackedPaneId("sess-1")).toBe("w9:p2")
		const paneRunCalls = calls.filter((call) => commandOf(call) === "pane run")
		expect(paneRunCalls).toHaveLength(1)

		await manager.cleanup()
	})

	test("#given a tracked herdr pane #when the session is deleted #then the pane is closed via pane close and tracking is finalized", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps(herdr.script)
		const manager = buildManager(ops)
		await manager.onSessionCreated(sessionCreatedEvent())
		calls.length = 0

		await manager.onSessionDeleted({ sessionID: "sess-1" })

		expect(calls).toEqual([["pane", "close", "w9:p2"]])
		expect(manager.getTrackedPaneId("sess-1")).toBeUndefined()

		await manager.cleanup()
	})

	test("#given the pane is already gone #when the session is deleted #then pane_not_found finalizes the close instead of wedging", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops } = fakeHerdrOps((args) => {
			if (args[0] === "pane" && args[1] === "close") {
				return errorEnvelope("pane_not_found", "pane w9:p2 not found")
			}
			return herdr.script(args)
		})
		const manager = buildManager(ops)
		await manager.onSessionCreated(sessionCreatedEvent())

		await manager.onSessionDeleted({ sessionID: "sess-1" })

		expect(manager.getTrackedPaneId("sess-1")).toBeUndefined()

		await manager.cleanup()
	})

	test("#given a real close failure #when the session is deleted #then the session is marked close-pending and stays tracked", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops } = fakeHerdrOps((args) => {
			if (args[0] === "pane" && args[1] === "close") {
				return errorEnvelope("server_error", "boom")
			}
			return herdr.script(args)
		})
		const manager = buildManager(ops)
		await manager.onSessionCreated(sessionCreatedEvent())

		await manager.onSessionDeleted({ sessionID: "sess-1" })

		expect(manager.getTrackedPaneId("sess-1")).toBe("w9:p2")
		expect(internalsOf(manager).sessions.get("sess-1")?.closePending).toBe(true)

		await manager.cleanup()
	})

	test("#given tracked herdr panes #when cleanup runs #then panes close and the agents workspace is torn down", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps(herdr.script)
		const manager = buildManager(ops)
		await manager.onSessionCreated(sessionCreatedEvent("sess-1", "first worker"))
		await manager.onSessionCreated(sessionCreatedEvent("sess-2", "second worker"))
		calls.length = 0

		await manager.cleanup()

		const paneCloses = calls.filter((call) => commandOf(call) === "pane close")
		expect(paneCloses.map((call) => call[2]).sort()).toEqual(["w9:p2", "w9:p3"])
		const workspaceClose = calls.find((call) => commandOf(call) === "workspace close")
		expect(workspaceClose?.[2]).toBe("w9")
		expect(manager.getTrackedPaneId("sess-1")).toBeUndefined()
	})

	test("#given max close retries with the pane provably gone #when retryPendingCloses runs #then the tracked session finalizes", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		let closeFailures = 0
		const { ops } = fakeHerdrOps((args) => {
			if (args[0] === "pane" && args[1] === "close") {
				closeFailures += 1
				if (closeFailures <= 4) return errorEnvelope("server_error", "wedged")
				// after retries give up, the pane is simply gone
				return errorEnvelope("pane_not_found", "pane w9:p2 not found")
			}
			if (args[0] === "agent" && args[1] === "list") {
				return { success: true, output: envelope({ agents: [] }) }
			}
			return herdr.script(args)
		})
		const manager = buildManager(ops)
		await manager.onSessionCreated(sessionCreatedEvent())

		await manager.onSessionDeleted({ sessionID: "sess-1" }) // close fails -> closePending
		// retry 1..3 fail; the max-retries handoff verifies liveness via the
		// agent inventory: the pane is absent, so the close finalizes.
		await internalsOf(manager).retryPendingCloses()
		await internalsOf(manager).retryPendingCloses()
		await internalsOf(manager).retryPendingCloses()

		expect(manager.getTrackedPaneId("sess-1")).toBeUndefined()

		await manager.cleanup()
	})

	test("#given the manager owns a workspace #when a session is created #then the stale sweep lists omo-agents herdr workspaces once", async () => {
		delete process.env.TMUX
		process.env.HERDR_BIN_PATH = import.meta.path

		const herdr = healthyHerdr()
		const { ops, calls } = fakeHerdrOps(herdr.script)
		const manager = buildManager(ops)
		// re-enable the once-per-manager sweep
		unsafeTestValue<{ staleSweepCompleted: boolean }>(manager).staleSweepCompleted = false

		await manager.onSessionCreated(sessionCreatedEvent())

		const workspaceLists = calls.filter((call) => commandOf(call) === "workspace list")
		expect(workspaceLists.length).toBeGreaterThanOrEqual(1)

		await manager.cleanup()
	})
})

describe("selectTmuxManagerEnvironmentPredicate on herdr", () => {
	test("does not require tmux but does require a callable herdr binary", () => {
		delete process.env.TMUX
		delete process.env.TMUX_PANE

		process.env.HERDR_BIN_PATH = import.meta.path
		expect(selectTmuxManagerEnvironmentPredicate("inline", "herdr")()).toBe(true)
		expect(selectTmuxManagerEnvironmentPredicate("session", "herdr")()).toBe(true)

		process.env.HERDR_BIN_PATH = "/nonexistent/herdr"
		expect(selectTmuxManagerEnvironmentPredicate("inline", "herdr")()).toBe(false)
	})

	test("keeps the tmux gates untouched when multiplexer is tmux or unset", () => {
		delete process.env.TMUX
		delete process.env.CMUX_SOCKET_PATH
		expect(selectTmuxManagerEnvironmentPredicate("inline")()).toBe(false)
		expect(selectTmuxManagerEnvironmentPredicate("window")()).toBe(false)
		expect(selectTmuxManagerEnvironmentPredicate("inline", "tmux")()).toBe(false)

		process.env.TMUX = "/tmp/real-tmux.sock,1,0"
		expect(selectTmuxManagerEnvironmentPredicate("inline")()).toBe(true)
		expect(selectTmuxManagerEnvironmentPredicate("window")()).toBe(true)
		delete process.env.TMUX
	})
})
