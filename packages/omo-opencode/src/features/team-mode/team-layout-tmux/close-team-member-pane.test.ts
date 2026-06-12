/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test, mock, spyOn } from "bun:test"

import * as sharedModule from "../../../shared"
import * as sharedTmuxModule from "../../../shared/tmux"
import { closeTeamMemberPane } from "./close-team-member-pane"

const closeTmuxPaneMock = mock(async (): Promise<boolean> => true)
const logMock = mock(() => undefined)

describe("closeTeamMemberPane", () => {
	afterEach(() => {
		mock.restore()
	})

	beforeEach(() => {
		closeTmuxPaneMock.mockClear()
		logMock.mockClear()

		closeTmuxPaneMock.mockResolvedValue(true)
		spyOn(sharedModule, "log").mockImplementation(logMock)
		spyOn(sharedTmuxModule, "closeTmuxPane").mockImplementation(closeTmuxPaneMock)
	})

	test("#given member has both tmuxPaneId and tmuxGridPaneId #when closeTeamMemberPane runs #then close is invoked for both ids (2 calls) and returns true when either succeeds", async () => {
		// given
		closeTmuxPaneMock.mockResolvedValueOnce(false)
		closeTmuxPaneMock.mockResolvedValueOnce(true)

		// when
		const result = await closeTeamMemberPane({ tmuxPaneId: "%42", tmuxGridPaneId: "%84" })

		// then
		expect(result).toBe(true)
		expect(closeTmuxPaneMock).toHaveBeenCalledTimes(2)
		expect(closeTmuxPaneMock).toHaveBeenCalledWith("%42")
		expect(closeTmuxPaneMock).toHaveBeenCalledWith("%84")
	})

	test("#given member has only tmuxPaneId #when closeTeamMemberPane runs #then close is invoked once and returns true when it succeeds", async () => {
		// when
		const result = await closeTeamMemberPane({ tmuxPaneId: "%42" })

		// then
		expect(result).toBe(true)
		expect(closeTmuxPaneMock).toHaveBeenCalledTimes(1)
		expect(closeTmuxPaneMock).toHaveBeenCalledWith("%42")
	})

	test("#given both closes fail #when closeTeamMemberPane runs #then returns false", async () => {
		// given
		closeTmuxPaneMock.mockResolvedValue(false)

		// when
		const result = await closeTeamMemberPane({ tmuxPaneId: "%42", tmuxGridPaneId: "%84" })

		// then
		expect(result).toBe(false)
		expect(closeTmuxPaneMock).toHaveBeenCalledTimes(2)
	})
})
