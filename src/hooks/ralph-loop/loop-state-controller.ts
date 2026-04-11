import type { RalphLoopOptions, RalphLoopState } from "./types"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	HOOK_NAME,
	ULTRAWORK_MAX_ITERATIONS,
	ULTRAWORK_VERIFICATION_PROMISE,
} from "./constants"
import { clearState, incrementIteration, readState, writeState } from "./storage"
import { log } from "../../shared/logger"

export function createLoopStateController(options: {
	directory: string
	stateDir: string | undefined
	config: RalphLoopOptions["config"] | undefined
}) {
	const directory = options.directory
	const stateDir = options.stateDir
	const config = options.config

	return {
		startLoop(
			sessionID: string,
			prompt: string,
			loopOptions?: {
				maxIterations?: number
				completionPromise?: string
				messageCountAtStart?: number
				ultrawork?: boolean
				strategy?: "reset" | "continue"
			},
		): boolean {
			const initialCompletionPromise =
				loopOptions?.completionPromise ??
				DEFAULT_COMPLETION_PROMISE
			const state: RalphLoopState = {
				active: true,
				iteration: 1,
				max_iterations: loopOptions?.ultrawork
					? ULTRAWORK_MAX_ITERATIONS
					: loopOptions?.maxIterations ??
						config?.default_max_iterations ??
						DEFAULT_MAX_ITERATIONS,
				message_count_at_start: loopOptions?.messageCountAtStart,
				completion_promise: initialCompletionPromise,
				initial_completion_promise: initialCompletionPromise,
				verification_attempt_id: undefined,
				verification_session_id: undefined,
				ultrawork: loopOptions?.ultrawork,
				verification_pending: undefined,
				strategy: loopOptions?.strategy ?? config?.default_strategy ?? "continue",
				started_at: new Date().toISOString(),
				prompt,
				session_id: sessionID,
			}

			const success = writeState(directory, state, stateDir)
			if (success) {
				log(`[${HOOK_NAME}] Loop started`, {
					sessionID,
					maxIterations: state.max_iterations,
					completionPromise: state.completion_promise,
				})
			}
			return success
		},

		cancelLoop(sessionID: string): boolean {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID) {
				return false
			}

			const success = clearState(directory, stateDir)
			if (success) {
				log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
			}
			return success
		},

		getState(): RalphLoopState | null {
			return readState(directory, stateDir)
		},

		clear(): boolean {
			return clearState(directory, stateDir)
		},

		incrementIteration(): RalphLoopState | null {
			return incrementIteration(directory, stateDir)
		},

		setSessionID(sessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state) {
				return null
			}

			state.session_id = sessionID
			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		setMessageCountAtStart(sessionID: string, messageCountAtStart: number): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID) {
				return null
			}

			state.message_count_at_start = messageCountAtStart
			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		markVerificationPending(sessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork) {
				return null
			}

			state.verification_pending = true
			state.completion_promise = ULTRAWORK_VERIFICATION_PROMISE
			state.verification_attempt_id = undefined
			state.verification_session_id = undefined
			state.initial_completion_promise ??= DEFAULT_COMPLETION_PROMISE

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		setVerificationSessionID(sessionID: string, verificationSessionID: string): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork || !state.verification_pending) {
				return null
			}

			state.verification_session_id = verificationSessionID

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},

		restartAfterFailedVerification(sessionID: string, messageCountAtStart?: number): RalphLoopState | null {
			const state = readState(directory, stateDir)
			if (!state || state.session_id !== sessionID || !state.ultrawork || !state.verification_pending) {
				return null
			}

			state.iteration += 1
			state.started_at = new Date().toISOString()
			state.completion_promise = state.initial_completion_promise ?? DEFAULT_COMPLETION_PROMISE
			state.verification_pending = undefined
			state.verification_attempt_id = undefined
			state.verification_session_id = undefined
			if (typeof messageCountAtStart === "number") {
				state.message_count_at_start = messageCountAtStart
			}

			if (!writeState(directory, state, stateDir)) {
				return null
			}

			return state
		},
	}
}
