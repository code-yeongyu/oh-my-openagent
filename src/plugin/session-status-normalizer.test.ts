import { describe, it, expect } from "bun:test"
import { normalizeSessionStatusToIdle } from "./session-status-normalizer"

type EventInput = { event: { type: string; properties?: Record<string, unknown> } }

describe("normalizeSessionStatusToIdle", () => {
	it("converts session.status with idle type to synthetic session.idle event", () => {
		//#given - a session.status event with type=idle
		const input: EventInput = {
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_abc123",
					status: { type: "idle" },
				},
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns a synthetic session.idle event
		expect(result).toEqual({
			event: {
				type: "session.idle",
				properties: {
					sessionID: "ses_abc123",
				},
			},
		})
	})

	it("returns null for session.status with busy type", () => {
		//#given - a session.status event with type=busy
		const input: EventInput = {
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_abc123",
					status: { type: "busy" },
				},
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns null (no synthetic idle event)
		expect(result).toBeNull()
	})

	it("returns null for session.status with retry type", () => {
		//#given - a session.status event with type=retry
		const input: EventInput = {
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_abc123",
					status: { type: "retry", attempt: 1, message: "retrying", next: 5000 },
				},
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns null
		expect(result).toBeNull()
	})

	it("returns null for non-session.status events", () => {
		//#given - a message.updated event
		const input: EventInput = {
			event: {
				type: "message.updated",
				properties: { info: { sessionID: "ses_abc123" } },
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns null
		expect(result).toBeNull()
	})

	it("returns null when session.status has no properties", () => {
		//#given - a session.status event with no properties
		const input: EventInput = {
			event: {
				type: "session.status",
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns null
		expect(result).toBeNull()
	})

	it("returns null when session.status has no status object", () => {
		//#given - a session.status event with sessionID but no status
		const input: EventInput = {
			event: {
				type: "session.status",
				properties: {
					sessionID: "ses_abc123",
				},
			},
		}

		//#when - normalizeSessionStatusToIdle is called
		const result = normalizeSessionStatusToIdle(input)

		//#then - returns null
		expect(result).toBeNull()
	})
})
