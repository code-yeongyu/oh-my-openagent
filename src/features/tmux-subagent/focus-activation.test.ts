import { describe, expect, test } from "bun:test"
import { getSessionsToActivate } from "./focus-activation"
import type { TrackedSession, WindowState } from "./types"

function createTrackedSession(overrides?: Partial<TrackedSession>): TrackedSession {
	return {
		sessionId: "ses_1",
		paneId: "%1",
		description: "Task",
		attachActivated: false,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		lastSeenAt: new Date("2026-01-01T00:00:00.000Z"),
		closePending: false,
		closeRetryCount: 0,
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
		agentPanes: [
			{
				paneId: "%1",
				width: 40,
				height: 44,
				left: 110,
				top: 0,
				title: "omo-subagent-Task",
				isActive: true,
			},
		],
		...overrides,
	}
}

describe("getSessionsToActivate", () => {
	test("returns focused tracked sessions that are not yet activated", () => {
		const sessions = new Map<string, TrackedSession>([["ses_1", createTrackedSession()]])

		const result = getSessionsToActivate(createWindowState(), sessions)

		expect(result).toHaveLength(1)
		expect(result[0]?.sessionId).toBe("ses_1")
	})

	test("skips unfocused panes and already activated sessions", () => {
		const sessions = new Map<string, TrackedSession>([
			["ses_1", createTrackedSession({ attachActivated: true })],
			["ses_2", createTrackedSession({ sessionId: "ses_2", paneId: "%2" })],
		])

		const result = getSessionsToActivate(
			createWindowState({
				agentPanes: [
					{
						paneId: "%1",
						width: 40,
						height: 44,
						left: 110,
						top: 0,
						title: "omo-subagent-Task 1",
						isActive: true,
					},
					{
						paneId: "%2",
						width: 40,
						height: 44,
						left: 150,
						top: 0,
						title: "omo-subagent-Task 2",
						isActive: false,
					},
				],
			}),
			sessions,
		)

		expect(result).toHaveLength(0)
	})
})
