import { describe, expect, test } from "bun:test"
import {
	createTrackedSession,
	markTrackedSessionActivated,
	markTrackedSessionClosePending,
} from "./tracked-session-state"

describe("tracked-session-state", () => {
	test("creates tracked sessions with activation disabled", () => {
		const tracked = createTrackedSession({
			sessionId: "ses_1",
			paneId: "%1",
			description: "Task",
		})

		expect(tracked.attachActivated).toBe(false)
	})

	test("activation marker is idempotent", () => {
		const tracked = createTrackedSession({
			sessionId: "ses_1",
			paneId: "%1",
			description: "Task",
		})

		const activatedOnce = markTrackedSessionActivated(tracked)
		const activatedTwice = markTrackedSessionActivated(activatedOnce)

		expect(activatedOnce.attachActivated).toBe(true)
		expect(activatedTwice).toEqual(activatedOnce)
	})

	test("close pending retry increments only after first pending state", () => {
		const tracked = createTrackedSession({
			sessionId: "ses_1",
			paneId: "%1",
			description: "Task",
		})

		const first = markTrackedSessionClosePending(tracked)
		const second = markTrackedSessionClosePending(first)

		expect(first.closePending).toBe(true)
		expect(first.closeRetryCount).toBe(0)
		expect(second.closeRetryCount).toBe(1)
	})
})
