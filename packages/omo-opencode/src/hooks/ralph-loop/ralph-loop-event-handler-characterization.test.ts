/// <reference path="../../../../../bun-test.d.ts" />

import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting, releasePromptAsyncReservation } from "../shared/prompt-async-gate"
import { latestUserMessageIsInProgress } from "./event-handler-activity"
import { createRalphLoopEventHandler } from "./ralph-loop-event-handler"
import type { IterationCommitExpectation, RalphLoopState } from "./types"

type PromptCall = {
	readonly sessionID: string
	readonly text: string
}

describe("ralph-loop event handler characterization", () => {
	afterEach(() => {
		releaseAllPromptAsyncReservationsForTesting()
	})

	test("#given synthetic idle already continued the loop #when matching real idle follows immediately #then Ralph injects only once", async () => {
		// given
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "session-123",
		}
		const promptCalls: PromptCall[] = []
		const commitExpectations: IterationCommitExpectation[] = []
		const handler = createRalphLoopEventHandler(unsafeTestValue({
			client: {
				session: {
					messages: async () => ({ data: [] }),
					promptAsync: async (input: {
						readonly path: { readonly id: string }
						readonly body: { readonly parts: readonly [{ readonly text: string }] }
					}) => {
						promptCalls.push({
							sessionID: input.path.id,
							text: input.body.parts[0].text,
						})
						return {}
					},
				},
				tui: {
					showToast: async () => ({}),
				},
			},
		}), {
			directory: "/tmp/ralph-loop-event-handler-characterization",
			apiTimeoutMs: 5000,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {
				getState: () => state,
				clear: () => {
					state = null
					return true
				},
				incrementIteration: (expected?: IterationCommitExpectation) => {
					if (expected) {
						commitExpectations.push(expected)
					}
					if (!state) return null
					state = { ...state, iteration: state.iteration + 1 }
					return state
				},
				setSessionID: (sessionID: string) => {
					if (!state) return null
					state = { ...state, session_id: sessionID }
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
			event: { type: "session.idle", properties: { sessionID: "session-123", synthetic: true } },
		})
		releasePromptAsyncReservation("session-123", "ralph-loop")
		await handler({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then
		expect(promptCalls).toHaveLength(1)
		expect(promptCalls[0]?.sessionID).toBe("session-123")
		expect(promptCalls[0]?.text).toContain("Keep working")
		expect(commitExpectations).toEqual([
			{ iteration: 1, sessionID: "session-123" },
		])
		expect(state?.iteration).toBe(2)
	})

	test("#given recent-user lookup stalls #when activity guard checks messages #then Ralph times out and treats it as no in-progress user turn", async () => {
		// given
		const ctx = unsafeTestValue<Parameters<typeof latestUserMessageIsInProgress>[0]>({
			client: {
				session: {
					messages: async () => await new Promise<unknown>(() => {}),
				},
			},
		})
		const options = unsafeTestValue<Parameters<typeof latestUserMessageIsInProgress>[1]>({
			directory: "/tmp/ralph-loop-event-handler-characterization",
			apiTimeoutMs: 5,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {},
		})

		// when
		const inProgress = await latestUserMessageIsInProgress(ctx, options, "session-123", Date.now())

		// then
		expect(inProgress).toBe(false)
	})

	test("#given real activity follows synthetic idle continuation #when the session idles again #then Ralph allows the next iteration", async () => {
		// given
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "session-123",
		}
		const promptCalls: PromptCall[] = []
		const commitExpectations: IterationCommitExpectation[] = []
		const handler = createRalphLoopEventHandler(unsafeTestValue({
			client: {
				session: {
					messages: async () => ({ data: [] }),
					promptAsync: async (input: {
						readonly path: { readonly id: string }
						readonly body: { readonly parts: readonly [{ readonly text: string }] }
					}) => {
						promptCalls.push({
							sessionID: input.path.id,
							text: input.body.parts[0].text,
						})
						return {}
					},
				},
				tui: {
					showToast: async () => ({}),
				},
			},
		}), {
			directory: "/tmp/ralph-loop-event-handler-characterization",
			apiTimeoutMs: 5000,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {
				getState: () => state,
				clear: () => {
					state = null
					return true
				},
				incrementIteration: (expected?: IterationCommitExpectation) => {
					if (expected) {
						commitExpectations.push(expected)
					}
					if (!state) return null
					state = { ...state, iteration: state.iteration + 1 }
					return state
				},
				setSessionID: (sessionID: string) => {
					if (!state) return null
					state = { ...state, session_id: sessionID }
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
			event: { type: "session.idle", properties: { sessionID: "session-123", synthetic: true } },
		})
		await handler({
			event: { type: "message.part.updated", properties: { sessionID: "session-123" } },
		})
		await handler({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then
		expect(promptCalls).toHaveLength(2)
		expect(commitExpectations).toEqual([
			{ iteration: 1, sessionID: "session-123" },
			{ iteration: 2, sessionID: "session-123" },
		])
		expect(state?.iteration).toBe(3)
	})
})
