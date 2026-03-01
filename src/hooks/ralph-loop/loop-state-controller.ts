import type { RalphLoopOptions, RalphLoopState } from "./types"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	HOOK_NAME,
} from "./constants"
import { clearState, findAnyActiveRalphLoopState, findSecondActiveRalphLoopState, incrementIteration, readState, writeState } from "./storage"
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
			const state: RalphLoopState = {
				active: true,
				iteration: 1,
				max_iterations:
					loopOptions?.maxIterations ??
					config?.default_max_iterations ??
					DEFAULT_MAX_ITERATIONS,
				message_count_at_start: loopOptions?.messageCountAtStart,
				completion_promise:
					loopOptions?.completionPromise ??
					DEFAULT_COMPLETION_PROMISE,
				ultrawork: loopOptions?.ultrawork,
				strategy: loopOptions?.strategy ?? config?.default_strategy ?? "continue",
				started_at: new Date().toISOString(),
				prompt,
				session_id: sessionID,
			}

			const success = writeState(directory, state, stateDir, stateDir ? undefined : sessionID)
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
			const state = readState(directory, stateDir, stateDir ? undefined : sessionID)
			if (!state || state.session_id !== sessionID) {
				return false
			}

			const success = clearState(directory, stateDir, stateDir ? undefined : sessionID)
			if (success) {
				log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
			}
			return success
		},

		getState(sessionID?: string): RalphLoopState | null {
			if (stateDir) return readState(directory, stateDir)
			if (sessionID) return readState(directory, undefined, sessionID)
			return readState(directory) ?? findAnyActiveRalphLoopState(directory)
		},

		clear(sessionID?: string): boolean {
			if (stateDir) return clearState(directory, stateDir)
			if (sessionID) return clearState(directory, undefined, sessionID)
			const active = readState(directory) ?? findAnyActiveRalphLoopState(directory)
			if (active?.session_id) return clearState(directory, undefined, active.session_id)
			return clearState(directory)
		},

		incrementIteration(sessionID?: string): RalphLoopState | null {
			if (stateDir) return incrementIteration(directory, stateDir)
			if (sessionID) return incrementIteration(directory, undefined, sessionID)
			const active = readState(directory) ?? findAnyActiveRalphLoopState(directory)
			if (active?.session_id) return incrementIteration(directory, undefined, active.session_id)
			return incrementIteration(directory)
		},

setSessionID(sessionID: string): RalphLoopState | null {
			let state: RalphLoopState | null = null

			if (stateDir) {
				// When stateDir is defined, read from that specific path
				state = readState(directory, stateDir)
			} else {
				// When stateDir is undefined, try legacy singleton first
				state = readState(directory)
				if (!state) {
					// No legacy singleton, try to find first active per-session state
					state = findAnyActiveRalphLoopState(directory)
					if (state && state.session_id) {
						// Check if a second active state exists (hijack prevention)
						const secondState = findSecondActiveRalphLoopState(directory, state.session_id)
						if (secondState) {
							// Multiple active states exist, abort to prevent hijacking
							return null
						}
					}
				}
			}

			if (!state) {
				return null
			}

			const oldSessionId = state.session_id
			state.session_id = sessionID
			if (!writeState(directory, state, stateDir, stateDir ? undefined : sessionID)) {
				return null
			}

			if (!stateDir && oldSessionId && oldSessionId !== sessionID) {
				clearState(directory, undefined, oldSessionId)
			}

			return state
		},

		setMessageCountAtStart(sessionID: string, messageCountAtStart: number): RalphLoopState | null {
			const state = readState(directory, stateDir, stateDir ? undefined : sessionID)
			if (!state || state.session_id !== sessionID) {
				return null
			}

			state.message_count_at_start = messageCountAtStart
			if (!writeState(directory, state, stateDir, stateDir ? undefined : sessionID)) {
				return null
			}

			return state
		},
	}
}
