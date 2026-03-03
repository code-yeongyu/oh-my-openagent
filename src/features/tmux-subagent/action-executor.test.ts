import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { TmuxConfig } from "../../config/schema"
import { executeActionWithDeps } from "./action-executor-core"
import type { ActionExecutorDeps, ExecuteContext } from "./action-executor-core"
import type { WindowState } from "./types"

const mockSpawnTmuxPane = mock(async () => ({ success: true, paneId: "%7" }))
const mockCloseTmuxPane = mock(async () => true)
const mockEnforceMainPaneWidth = mock(async () => undefined)
const mockReplaceTmuxPane = mock(async () => ({ success: true, paneId: "%7" }))
const mockApplyLayout = mock(async () => undefined)

const mockDeps: ActionExecutorDeps = {
	spawnTmuxPane: mockSpawnTmuxPane,
	closeTmuxPane: mockCloseTmuxPane,
	enforceMainPaneWidth: mockEnforceMainPaneWidth,
	replaceTmuxPane: mockReplaceTmuxPane,
	applyLayout: mockApplyLayout,
}

function createConfig(overrides?: Partial<TmuxConfig>): TmuxConfig {
	return {
		enabled: true,
		layout: "main-horizontal",
		main_pane_size: 55,
		main_pane_min_width: 120,
		agent_pane_min_width: 40,
		...overrides,
	}
}

function createWindowState(overrides?: Partial<WindowState>): WindowState {
	return {
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
		...overrides,
	}
}

function createContext(overrides?: Partial<ExecuteContext>): ExecuteContext {
	return {
		config: createConfig(),
		serverUrl: "http://localhost:4096",
		windowState: createWindowState(),
		...overrides,
	}
}

describe("executeAction", () => {
	beforeEach(() => {
		mockSpawnTmuxPane.mockClear()
		mockCloseTmuxPane.mockClear()
		mockEnforceMainPaneWidth.mockClear()
		mockReplaceTmuxPane.mockClear()
		mockApplyLayout.mockClear()
		mockSpawnTmuxPane.mockImplementation(async () => ({ success: true, paneId: "%7" }))
	})

	test("enforces main pane width with configured percentage after successful spawn", async () => {
		// given
		// when
		const result = await executeActionWithDeps(
			{
				type: "spawn",
				sessionId: "ses_new",
				description: "background task",
				targetPaneId: "%0",
				splitDirection: "-h",
			},
			createContext(),
			mockDeps,
		)

		// then
		expect(result).toEqual({ success: true, paneId: "%7" })
		expect(mockApplyLayout).not.toHaveBeenCalled()
		expect(mockEnforceMainPaneWidth).toHaveBeenCalledTimes(1)
		expect(mockEnforceMainPaneWidth).toHaveBeenCalledWith("%0", 220, 55)
	})

	test("does not apply layout when spawn fails", async () => {
		// given
		mockSpawnTmuxPane.mockImplementationOnce(async () => ({ success: false }))

		// when
		const result = await executeActionWithDeps(
			{
				type: "spawn",
				sessionId: "ses_new",
				description: "background task",
				targetPaneId: "%0",
				splitDirection: "-h",
			},
			createContext(),
			mockDeps,
		)

		// then
		expect(result).toEqual({ success: false, paneId: undefined })
		expect(mockApplyLayout).not.toHaveBeenCalled()
		expect(mockEnforceMainPaneWidth).not.toHaveBeenCalled()
	})
})
