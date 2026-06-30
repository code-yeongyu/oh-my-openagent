/// <reference path="../../../../../bun-test.d.ts" />

import { existsSync, mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { _flushForTesting, _resetLoggerForTesting, _setLoggerForTesting } from "../../shared/logger"
import {
	dispatchInternalPrompt,
	releaseAllPromptAsyncReservationsForTesting,
	releasePromptAsyncReservation,
} from "../shared/prompt-async-gate"
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
		_resetLoggerForTesting()
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

	test("#given runtime retry marker but another route owns the reservation #when retried activity arrives #then Ralph clears only its marker", async () => {
		// given
		const logDir = mkdtempSync(join(tmpdir(), "ralph-loop-runtime-marker-"))
		const logFile = join(logDir, "oh-my-opencode.log")
		_setLoggerForTesting({ filePath: logFile })
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
		const client = unsafeTestValue({
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
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
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
				incrementIteration: () => {
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

		await handler({
			event: {
				type: "session.error",
				properties: {
					sessionID: "session-123",
					error: { name: "RuntimeError" },
				},
			},
		})
		expect(releasePromptAsyncReservation("session-123", "ralph-loop")).toBe(true)
		const reservation = await dispatchInternalPrompt({
			mode: "async",
			client,
			sessionID: "session-123",
			source: "model-suggestion-retry",
			settleMs: 0,
			postDispatchHoldMs: 10_000,
			input: {
				path: { id: "session-123" },
				body: {
					parts: [{ type: "text", text: "retry through another route" }],
				},
			},
		})

		// when
		await handler({
			event: { type: "message.part.delta", properties: { sessionID: "session-123" } },
		})
		_flushForTesting()
		const logContent = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
		const releasedByOwner = releasePromptAsyncReservation("session-123", "model-suggestion-retry")

		// then
		expect(reservation.status).toBe("dispatched")
		expect(releasedByOwner).toBe(true)
		expect(logContent).not.toContain("promptAsync reservation release skipped for different source")
		expect(promptCalls).toHaveLength(2)
	})

	test("#given runtime retry marker but Ralph state is inactive #when retried activity arrives #then stale marker is cleared", async () => {
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
		const client = unsafeTestValue({
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
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
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
				incrementIteration: () => {
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

		await handler({
			event: {
				type: "session.error",
				properties: {
					sessionID: "session-123",
					error: { name: "RuntimeError" },
				},
			},
		})
		state = null

		// when
		await handler({
			event: { type: "message.part.delta", properties: { sessionID: "session-123" } },
		})
		state = {
			active: true,
			iteration: 2,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "session-123",
		}
		await handler({
			event: { type: "session.idle", properties: { sessionID: "session-123" } },
		})

		// then
		expect(promptCalls).toHaveLength(2)
		expect(state?.iteration).toBe(3)
	})

	test("#given child session has a retry reservation #when unrelated child activity arrives #then Ralph does not attempt to release it", async () => {
		// given
		const logDir = mkdtempSync(join(tmpdir(), "ralph-loop-scope-"))
		const logFile = join(logDir, "oh-my-opencode.log")
		_setLoggerForTesting({ filePath: logFile })
		let getStateCalls = 0
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "parent-session",
		}
		const promptCalls: PromptCall[] = []
		const client = unsafeTestValue({
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
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
			directory: "/tmp/ralph-loop-event-handler-characterization",
			apiTimeoutMs: 5000,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {
				getState: () => {
					getStateCalls++
					return state
				},
				clear: () => {
					state = null
					return true
				},
				incrementIteration: () => state,
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
		const reservation = await dispatchInternalPrompt({
			mode: "async",
			client,
			sessionID: "child-session",
			source: "model-suggestion-retry",
			settleMs: 0,
			postDispatchHoldMs: 10_000,
			input: {
				path: { id: "child-session" },
				body: {
					parts: [{ type: "text", text: "retry child" }],
				},
			},
		})

		// when
		await handler({
			event: { type: "message.part.delta", properties: { sessionID: "child-session" } },
		})
		_flushForTesting()
		const logContent = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
		const releasedByOwner = releasePromptAsyncReservation("child-session", "model-suggestion-retry")

		// then
		expect(reservation.status).toBe("dispatched")
		expect(getStateCalls).toBe(0)
		expect(releasedByOwner).toBe(true)
		expect(logContent).not.toContain("promptAsync reservation release skipped for different source")
		expect(promptCalls).toHaveLength(1)
	})

	test("#given verification session is owned by model suggestion retry #when verification activity arrives #then Ralph leaves that hold alone", async () => {
		// given
		const logDir = mkdtempSync(join(tmpdir(), "ralph-loop-verification-"))
		const logFile = join(logDir, "oh-my-opencode.log")
		_setLoggerForTesting({ filePath: logFile })
		let getStateCalls = 0
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "parent-session",
			verification_pending: true,
			verification_session_id: "verification-session",
		}
		const client = unsafeTestValue({
			session: {
				messages: async () => ({ data: [] }),
				promptAsync: async () => ({}),
			},
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
			directory: "/tmp/ralph-loop-event-handler-characterization",
			apiTimeoutMs: 5000,
			idleSettleMs: 0,
			getTranscriptPath: () => undefined,
			loopState: {
				getState: () => {
					getStateCalls++
					return state
				},
				clear: () => {
					state = null
					return true
				},
				incrementIteration: () => state,
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
		const reservation = await dispatchInternalPrompt({
			mode: "async",
			client,
			sessionID: "verification-session",
			source: "model-suggestion-retry",
			settleMs: 0,
			postDispatchHoldMs: 10_000,
			input: {
				path: { id: "verification-session" },
				body: {
					parts: [{ type: "text", text: "verify" }],
				},
			},
		})

		// when
		await handler({
			event: { type: "message.part.updated", properties: { sessionID: "verification-session" } },
		})
		_flushForTesting()
		const logContent = existsSync(logFile) ? readFileSync(logFile, "utf8") : ""
		const releasedByOwner = releasePromptAsyncReservation("verification-session", "model-suggestion-retry")

		// then
		expect(reservation.status).toBe("dispatched")
		expect(getStateCalls).toBe(0)
		expect(releasedByOwner).toBe(true)
		expect(logContent).not.toContain("promptAsync reservation release skipped for different source")
	})

	test("#given verification session has a Ralph reservation #when verification activity arrives #then Ralph may release it", async () => {
		// given
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "parent-session",
			verification_pending: true,
			verification_session_id: "verification-session",
		}
		const promptCalls: PromptCall[] = []
		const client = unsafeTestValue({
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
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
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
				incrementIteration: () => state,
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
		const reservation = await dispatchInternalPrompt({
			mode: "async",
			client,
			sessionID: "verification-session",
			source: "ralph-loop",
			settleMs: 0,
			postDispatchHoldMs: 10_000,
			input: {
				path: { id: "verification-session" },
				body: {
					parts: [{ type: "text", text: "verify" }],
				},
			},
		})

		// when
		await handler({
			event: { type: "message.part.updated", properties: { sessionID: "verification-session" } },
		})
		const releasedAfterHandler = releasePromptAsyncReservation("verification-session", "ralph-loop")

		// then
		expect(reservation.status).toBe("dispatched")
		expect(releasedAfterHandler).toBe(false)
		expect(promptCalls).toHaveLength(1)
	})

	test("#given child subagent activity with a non-Ralph prompt hold #when Ralph observes the event #then it ignores the child session without mismatch spam", async () => {
		// given
		let state: RalphLoopState | null = {
			active: true,
			iteration: 1,
			max_iterations: 5,
			completion_promise: "DONE",
			started_at: new Date().toISOString(),
			prompt: "Keep working",
			session_id: "parent-session",
		}
		const logFilePath = join(mkdtempSync(join(tmpdir(), "ralph-child-activity-")), "omo.log")
		_setLoggerForTesting({ filePath: logFilePath, maxSizeBytes: 1024 * 1024, maxBackups: 1 })
		const promptCalls: PromptCall[] = []
		const client = unsafeTestValue({
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
		})
		const handler = createRalphLoopEventHandler(unsafeTestValue({ client }), {
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
				incrementIteration: () => state,
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
		const reservation = await dispatchInternalPrompt({
			mode: "async",
			client,
			sessionID: "child-explore-session",
			source: "model-suggestion-retry",
			settleMs: 0,
			postDispatchHoldMs: 10_000,
			input: {
				path: { id: "child-explore-session" },
				body: {
					parts: [{ type: "text", text: "retry child" }],
				},
			},
		})

		// when
		await handler({
			event: { type: "message.part.updated", properties: { sessionID: "child-explore-session" } },
		})
		_flushForTesting()
		const releasedByOwner = releasePromptAsyncReservation("child-explore-session", "model-suggestion-retry")
		const logText = existsSync(logFilePath) ? readFileSync(logFilePath, "utf8") : ""

		// then
		expect(reservation.status).toBe("dispatched")
		expect(releasedByOwner).toBe(true)
		expect(promptCalls).toHaveLength(1)
		expect(logText).not.toContain("promptAsync reservation release skipped for different source")
	})
})
