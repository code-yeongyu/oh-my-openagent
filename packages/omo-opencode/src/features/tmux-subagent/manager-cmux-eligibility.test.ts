import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { TmuxConfig } from "../../config/schema"
import type { ActionResult, ExecuteActionsResult } from "./action-executor"
import { selectTmuxManagerEnvironmentPredicate } from "./environment-eligibility"
import { TmuxSessionManager, type TmuxUtilDeps } from "./manager"
import type { PaneAction, WindowState } from "./types"

const originalTmux = process.env.TMUX
const originalTmuxPane = process.env.TMUX_PANE
const originalCmuxSocketPath = process.env.CMUX_SOCKET_PATH

const config = {
	enabled: true,
	isolation: "inline",
	layout: "main-vertical",
	main_pane_size: 60,
	main_pane_min_width: 80,
	agent_pane_min_width: 40,
} satisfies TmuxConfig

const windowState = {
	windowWidth: 220,
	windowHeight: 44,
	mainPane: {
		paneId: "%0",
		width: 110,
		height: 44,
		left: 0,
		top: 0,
		title: "main",
		isActive: true,
	},
	agentPanes: [],
} satisfies WindowState

function restoreEnvironment(): void {
	if (originalTmux === undefined) delete process.env.TMUX
	else process.env.TMUX = originalTmux
	if (originalTmuxPane === undefined) delete process.env.TMUX_PANE
	else process.env.TMUX_PANE = originalTmuxPane
	if (originalCmuxSocketPath === undefined) delete process.env.CMUX_SOCKET_PATH
	else process.env.CMUX_SOCKET_PATH = originalCmuxSocketPath
}

describe("TmuxSessionManager cmux eligibility", () => {
	beforeEach(() => {
		delete process.env.TMUX
		process.env.TMUX_PANE = "%0"
		process.env.CMUX_SOCKET_PATH = "/tmp/cmux.sock"
	})

	afterEach(() => {
		restoreEnvironment()
	})

	test("#given CMUX_SOCKET_PATH and TMUX_PANE without TMUX #when child session is created #then inline spawn reaches the source pane", async () => {
		// given
		const queryWindowState = mock(async (): Promise<WindowState> => windowState)
		const executeActions = mock(async (actions: PaneAction[]): Promise<ExecuteActionsResult> => {
			const results = actions.map((action): { action: PaneAction; result: ActionResult } => ({
				action,
				result: action.type === "spawn"
					? { success: true, paneId: "%42" }
					: { success: true },
			}))
			return { success: true, spawnedPaneId: "%42", results }
		})
		const context = unsafeTestValue<PluginInput>({
			directory: "/tmp/omo-project",
			serverUrl: new URL("http://127.0.0.1:4096"),
			client: {
				session: {
					status: mock(async () => ({
						data: { "session-cmux-only": { type: "running" } },
					})),
				},
			},
		})
		const deps = {
			isInsideTmux: selectTmuxManagerEnvironmentPredicate(config.isolation),
			queryWindowState,
			waitForSessionReady: mock(async () => true),
			executeActions,
			executeAction: mock(async (): Promise<ActionResult> => ({ success: true })),
			log: mock(() => undefined),
		} satisfies Partial<TmuxUtilDeps>
		const manager = new TmuxSessionManager(context, config, deps)
		unsafeTestValue<{ staleSweepCompleted: boolean }>(manager).staleSweepCompleted = true

		// when
		await manager.onSessionCreated({
			type: "session.created",
			properties: {
				info: {
					id: "session-cmux-only",
					parentID: "parent-session",
					title: "cmux worker",
				},
			},
		})

		// then
		expect(queryWindowState).toHaveBeenCalledWith("%0")
		expect(executeActions).toHaveBeenCalledTimes(1)
		expect(manager.getTrackedPaneId("session-cmux-only")).toBe("%42")

		await manager.cleanup()
	})

	test("#given CMUX_SOCKET_PATH without TMUX #when isolation is window #then unsupported container spawn stays disabled", async () => {
		// given
		const queryWindowState = mock(async (): Promise<WindowState> => windowState)
		const executeActions = mock(async (): Promise<ExecuteActionsResult> => ({
			success: true,
			results: [],
		}))
		const context = unsafeTestValue<PluginInput>({
			directory: "/tmp/omo-project",
			serverUrl: new URL("http://127.0.0.1:4096"),
			client: {
				session: {
					status: mock(async () => ({
						data: { "session-isolated": { type: "running" } },
					})),
				},
			},
		})
		const manager = new TmuxSessionManager(
			context,
			{ ...config, isolation: "window" },
			{
				isInsideTmux: selectTmuxManagerEnvironmentPredicate("window"),
				queryWindowState,
				waitForSessionReady: mock(async () => true),
				executeActions,
				executeAction: mock(async (): Promise<ActionResult> => ({ success: true })),
				log: mock(() => undefined),
			},
		)

		// when
		await manager.onSessionCreated({
			type: "session.created",
			properties: {
				info: {
					id: "session-isolated",
					parentID: "parent-session",
					title: "isolated worker",
				},
			},
		})

		// then
		expect(queryWindowState).not.toHaveBeenCalled()
		expect(executeActions).not.toHaveBeenCalled()

		await manager.cleanup()
	})

	test("#given cmux fake TMUX #when isolation is window #then unsupported container spawn stays disabled", async () => {
		// given
		process.env.TMUX = "/tmp/cmuxterm-test.sock,1234,0"
		const environmentEligible = selectTmuxManagerEnvironmentPredicate("window")
		const queryWindowState = mock(async (): Promise<WindowState | null> => null)
		const context = unsafeTestValue<PluginInput>({
			directory: "/tmp/omo-project",
			serverUrl: new URL("http://127.0.0.1:4096"),
			client: { session: { status: mock(async () => ({ data: {} })) } },
		})
		const manager = new TmuxSessionManager(
			context,
			{ ...config, isolation: "window" },
			{
				isInsideTmux: selectTmuxManagerEnvironmentPredicate("window"),
				queryWindowState,
				waitForSessionReady: mock(async () => true),
				log: mock(() => undefined),
			},
		)

		// when
		await manager.onSessionCreated({
			type: "session.created",
			properties: {
				info: {
					id: "session-cmux-window",
					parentID: "parent-session",
					title: "isolated worker",
				},
			},
		})

		// then
		expect(environmentEligible()).toBe(false)
		expect(queryWindowState).not.toHaveBeenCalled()

		await manager.cleanup()
	})
})
