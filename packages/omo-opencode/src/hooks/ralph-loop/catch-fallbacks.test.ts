import { describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { handleDetectedCompletion } from "./completion-handler"
import { continueIteration } from "./iteration-continuation"
import { latestAssistantTurnMadeNoProgress } from "./no-progress-turn-detector"
import { handlePendingVerification } from "./pending-verification-handler"
import { createIterationSession, selectSessionInTui } from "./session-reset-strategy"
import type { RalphLoopState } from "./types"
import { handleFailedVerification } from "./verification-failure-handler"
import { ULTRAWORK_VERIFICATION_PROMISE } from "./constants"

const NON_ERROR_FAILURE = { reason: "non-error failure" }

function createState(overrides: Partial<RalphLoopState> = {}): RalphLoopState {
	return {
		active: true,
		iteration: 1,
		prompt: "Build API",
		started_at: new Date().toISOString(),
		session_id: "session-123",
		completion_promise: "DONE",
		...overrides,
	}
}

describe("ralph-loop catch fallbacks", () => {
	test("#given session.messages throws a non-Error #when checking no-progress #then detector returns false", async () => {
		// given
		const ctx = unsafeTestValue<PluginInput>({
			client: {
				session: {
					messages: async () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})

		// when
		const result = await latestAssistantTurnMadeNoProgress(ctx, {
			sessionID: "session-123",
			directory: "/tmp",
			apiTimeoutMs: 100,
		})

		// then
		expect(result).toBe(false)
	})

	test("#given continuation prompt lookup throws a non-Error #when continuing iteration #then dispatch rejection is returned", async () => {
		// given
		const ctx = unsafeTestValue<PluginInput>({
			directory: "/tmp",
			client: {
				session: {
					messages: async () => {
						throw NON_ERROR_FAILURE
					},
					promptAsync: async () => ({}),
				},
			},
		})

		// when
		const result = await continueIteration(ctx, createState(), {
			directory: "/tmp",
			apiTimeoutMs: 100,
			idleSettleMs: 0,
			previousSessionID: "session-123",
			loopState: {
				setSessionID: () => createState({ session_id: "session-new" }),
			},
		})

		// then
		expect(result).toEqual({ status: "dispatch_rejected", error: NON_ERROR_FAILURE })
	})

	test("#given reset session APIs throw non-Errors #when best-effort reset helpers run #then fallback values are returned", async () => {
		// given
		const createCtx = unsafeTestValue<PluginInput>({
			client: {
				session: {
					create: async () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})
		const selectClient = unsafeTestValue<PluginInput["client"]>({
			tui: {
				selectSession: async () => {
					throw NON_ERROR_FAILURE
				},
			},
		})

		// when
		const createdSessionID = await createIterationSession(createCtx, "session-parent", "/tmp")
		const selected = await selectSessionInTui(selectClient, "session-123")

		// then
		expect(createdSessionID).toBeNull()
		expect(selected).toBe(false)
	})

	test("#given verification retry reads throw a non-Error #when handling failed verification #then handler returns false", async () => {
		// given
		const ctx = unsafeTestValue<PluginInput>({
			client: {
				session: {
					messages: async () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})

		// when
		const result = await handleFailedVerification(ctx, {
			state: createState({
				verification_pending: true,
				verification_session_id: "ses_oracle",
			}),
			directory: "/tmp",
			apiTimeoutMs: 100,
			loopState: {
				clearVerificationState: () => createState(),
				incrementIteration: () => createState({ iteration: 2 }),
				clear: () => true,
			},
		})

		// then
		expect(result).toBe(false)
	})

	test("#given completion toast throws a non-Error #when completion is handled #then loop still clears", async () => {
		// given
		let cleared = false
		const ctx = unsafeTestValue<PluginInput>({
			client: {
				tui: {
					showToast: () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})

		// when
		await handleDetectedCompletion(ctx, {
			sessionID: "session-123",
			state: createState(),
			loopState: {
				clear: () => {
					cleared = true
					return true
				},
				markVerificationPending: () => createState({ verification_pending: true }),
			},
			directory: "/tmp",
			apiTimeoutMs: 100,
		})

		// then
		expect(cleared).toBe(true)
	})

	test("#given pending verification scan throws a non-Error #when parent idles #then handler resolves", async () => {
		// given
		const ctx = unsafeTestValue<PluginInput>({
			client: {
				session: {
					messages: async () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})

		// when
		const result = handlePendingVerification(ctx, {
			sessionID: "session-123",
			state: createState({ verification_pending: true }),
			matchesParentSession: true,
			matchesVerificationSession: false,
			loopState: {
				restartAfterFailedVerification: () => createState(),
				clearVerificationState: () => createState(),
				incrementIteration: () => createState({ iteration: 2 }),
				clear: () => true,
				setVerificationSessionID: () => createState({ verification_session_id: "ses_oracle" }),
			},
			directory: "/tmp",
			apiTimeoutMs: 100,
		})

		// then
		await expect(result).resolves.toBeUndefined()
	})

	test("#given recovered verification completion toast throws a non-Error #when parent evidence completes loop #then loop still clears", async () => {
		// given
		let cleared = false
		const ctx = unsafeTestValue<PluginInput>({
			client: {
				session: {
					messages: async () => ({
						data: [{
							info: { role: "assistant" },
							parts: [{
								type: "text",
								text: [
									"Agent: Oracle",
									`<promise>${ULTRAWORK_VERIFICATION_PROMISE}</promise>`,
									"<task_metadata>",
									"session_id: ses_oracle",
									"</task_metadata>",
								].join("\n"),
							}],
						}],
					}),
				},
				tui: {
					showToast: () => {
						throw NON_ERROR_FAILURE
					},
				},
			},
		})

		// when
		await handlePendingVerification(ctx, {
			sessionID: "session-123",
			state: createState({
				completion_promise: ULTRAWORK_VERIFICATION_PROMISE,
				verification_pending: true,
			}),
			matchesParentSession: true,
			matchesVerificationSession: false,
			loopState: {
				restartAfterFailedVerification: () => createState(),
				clearVerificationState: () => createState(),
				incrementIteration: () => createState({ iteration: 2 }),
				clear: () => {
					cleared = true
					return true
				},
				setVerificationSessionID: () => createState({ verification_session_id: "ses_oracle" }),
			},
			directory: "/tmp",
			apiTimeoutMs: 100,
		})

		// then
		expect(cleared).toBe(true)
	})
})
