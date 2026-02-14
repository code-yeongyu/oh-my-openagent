import type { RalphLoopOptions, RalphLoopState } from "./types"
import {
	DEFAULT_COMPLETION_PROMISE,
	DEFAULT_MAX_ITERATIONS,
	HOOK_NAME,
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
          completionDetectionEnabled?: boolean
					ultrawork?: boolean
          mode?: RalphLoopState["mode"]
          maxDurationMs?: number
				},
			): boolean {
        const mode =
          loopOptions?.mode ??
          (loopOptions?.ultrawork ? "ulw" : "standard")
        const deadlineAt =
          loopOptions?.maxDurationMs && loopOptions.maxDurationMs > 0
            ? new Date(Date.now() + loopOptions.maxDurationMs).toISOString()
            : undefined

				const state: RalphLoopState = {
					active: true,
					iteration: 1,
					max_iterations:
					loopOptions?.maxIterations ??
					config?.default_max_iterations ??
					DEFAULT_MAX_ITERATIONS,
					completion_promise:
						loopOptions?.completionPromise ??
						DEFAULT_COMPLETION_PROMISE,
          completion_detection_enabled:
            loopOptions?.completionDetectionEnabled ?? true,
					ultrawork: loopOptions?.ultrawork,
          mode,
          max_duration_ms: loopOptions?.maxDurationMs,
          deadline_at: deadlineAt,
					started_at: new Date().toISOString(),
					prompt,
					session_id: sessionID,
				}

			const success = writeState(directory, state, stateDir)
				if (success) {
					log(`[${HOOK_NAME}] Loop started`, {
						sessionID,
            mode: state.mode,
						maxIterations: state.max_iterations,
						completionPromise: state.completion_promise,
            completionDetectionEnabled: state.completion_detection_enabled,
            maxDurationMs: state.max_duration_ms,
            deadlineAt: state.deadline_at,
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
	}
}
