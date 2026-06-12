/// <reference path="../../../../../bun-test.d.ts" />

import { describe, expect, test } from "bun:test"
import { createRalphLoopEventHandler } from "./ralph-loop-event-handler"
import type { IterationCommitExpectation, RalphLoopState } from "./types"

describe("ralph-loop iteration commit ownership", () => {
	test("#given reset strategy creates a new session #when dispatch commits #then CAS expects the new owner", async () => {
		// given
		const commitExpectations: IterationCommitExpectation[] = []
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "session-old",
			strategy: "reset",
		}
		const handler = createRalphLoopEventHandler({
			directory: "/tmp/ralph-loop-iteration-commit-ownership",
			client: {
				session: {
					messages: async () => ({ data: [] }),
					create: async () => ({ data: { id: "session-new" } }),
					promptAsync: async () => ({}),
				},
				tui: {
					showToast: async () => ({}),
					selectSession: async () => ({}),
				},
			},
		} as never, {
			directory: "/tmp/ralph-loop-iteration-commit-ownership",
			apiTimeoutMs: 5000,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {
				getState: () => state,
				clear: () => {
					state = null
					return true
				},
				setSessionID: (sessionID: string) => {
					if (!state) return null
					state = { ...state, session_id: sessionID }
					return state
				},
				incrementIteration: (expected?: IterationCommitExpectation) => {
					if (expected) {
						commitExpectations.push(expected)
					}
					if (!state) return null
					state = { ...state, iteration: state.iteration + 1 }
					return state
				},
				markVerificationPending: () => state,
				setVerificationSessionID: () => state,
				restartAfterFailedVerification: () => state,
				clearVerificationState: () => state,
			},
		})

		// when
		await handler({
			event: { type: "session.idle", properties: { sessionID: "session-old" } },
		})

		// then
		expect(commitExpectations).toEqual([
			{ iteration: 1, sessionID: "session-new" },
		])
		expect(state?.iteration).toBe(2)
		expect(state?.session_id).toBe("session-new")
	})
})
