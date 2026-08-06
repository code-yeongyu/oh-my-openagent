import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { handlePendingVerification, STUCK_VERIFICATION_TIMEOUT_MS } from "./pending-verification-handler"
import type { RalphLoopState } from "./types"

const NOW_MS = 1_800_000_000_000

type PendingVerificationInput = Parameters<typeof handlePendingVerification>[1]
type LoopStateController = PendingVerificationInput["loopState"]

function createState(verificationAttemptStartedAt?: number): RalphLoopState {
	const state: RalphLoopState = {
		active: true,
		iteration: 2,
		completion_promise: "<ulw-verification>",
		initial_completion_promise: "<promise>DONE</promise>",
		started_at: "2026-01-01T00:00:00.000Z",
		prompt: "Ship release blockers",
		session_id: "session-123",
		ultrawork: true,
		verification_pending: true,
		verification_attempt_id: "attempt-123",
	}

	if (verificationAttemptStartedAt === undefined) {
		return state
	}

	return {
		...state,
		verification_attempt_started_at: verificationAttemptStartedAt,
	}
}

function createPluginInput(promptCalls: string[]): PluginInput {
	return unsafeTestValue<PluginInput>({
		client: {
			session: {
				messages: async () => ({ data: [] }),
				promptAsync: async (input: unknown) => {
					promptCalls.push(JSON.stringify(input) ?? "")
					return {}
				},
				abort: async () => ({}),
			},
			tui: {
				showToast: async () => ({}),
			},
		},
		directory: "/tmp/ralph-loop-stuck-oracle-test",
	})
}

function createLoopStateController(state: RalphLoopState) {
	const clearVerificationState = mock<LoopStateController["clearVerificationState"]>(() => state)
	const incrementIteration = mock<LoopStateController["incrementIteration"]>(() => state)
	const loopState = {
		restartAfterFailedVerification: mock<LoopStateController["restartAfterFailedVerification"]>(() => null),
		clearVerificationState,
		incrementIteration,
		clear: mock<LoopStateController["clear"]>(() => true),
		setVerificationSessionID: mock<LoopStateController["setVerificationSessionID"]>(() => null),
	} satisfies LoopStateController

	return { loopState, clearVerificationState, incrementIteration }
}

async function runPendingVerification(state: RalphLoopState, loopState: LoopStateController, promptCalls: string[]) {
	await handlePendingVerification(createPluginInput(promptCalls), {
		sessionID: "session-123",
		state,
		matchesParentSession: true,
		matchesVerificationSession: false,
		loopState,
		directory: "/tmp/ralph-loop-stuck-oracle-test",
		apiTimeoutMs: 100,
	})
}

describe("ralph-loop stuck oracle dispatch recovery", () => {
	const realDateNow = Date.now

	beforeEach(() => {
		Date.now = () => NOW_MS
	})

	afterEach(() => {
		Date.now = realDateNow
		releaseAllPromptAsyncReservationsForTesting()
	})

	test("#given verification attempt is recent and no verification session exists #when pending verification is handled #then handler returns early", async () => {
		// given
		const promptCalls: string[] = []
		const state = createState(NOW_MS - 1_000)
		const { loopState, clearVerificationState, incrementIteration } = createLoopStateController(state)

		// when
		await runPendingVerification(state, loopState, promptCalls)

		// then
		expect(promptCalls).toHaveLength(0)
		expect(clearVerificationState).not.toHaveBeenCalled()
		expect(incrementIteration).not.toHaveBeenCalled()
	})

	test("#given verification attempt is older than stuck timeout and no verification session exists #when pending verification is handled #then handler proceeds to failed verification recovery", async () => {
		// given
		const promptCalls: string[] = []
		const state = createState(NOW_MS - STUCK_VERIFICATION_TIMEOUT_MS - 1)
		const { loopState, clearVerificationState, incrementIteration } = createLoopStateController(state)

		// when
		await runPendingVerification(state, loopState, promptCalls)

		// then
		expect(promptCalls).toHaveLength(1)
		expect(clearVerificationState).toHaveBeenCalledTimes(1)
		expect(incrementIteration).toHaveBeenCalledTimes(1)
	})

	test("#given legacy verification attempt has no start timestamp and no verification session exists #when pending verification is handled #then handler returns early", async () => {
		// given
		const promptCalls: string[] = []
		const state = createState()
		const { loopState, clearVerificationState, incrementIteration } = createLoopStateController(state)

		// when
		await runPendingVerification(state, loopState, promptCalls)

		// then
		expect(promptCalls).toHaveLength(0)
		expect(clearVerificationState).not.toHaveBeenCalled()
		expect(incrementIteration).not.toHaveBeenCalled()
	})
})
