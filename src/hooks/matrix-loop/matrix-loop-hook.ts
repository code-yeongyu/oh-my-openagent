import type { PluginInput } from "@opencode-ai/plugin"
import type { MatrixLoopOptions, MatrixLoopState } from "./types"
import { getTranscriptPath as getDefaultTranscriptPath } from "../../shared/transcript-path"
import { createLoopSessionRecovery } from "./loop-session-recovery"
import { createLoopStateController } from "./loop-state-controller"
import { createMatrixLoopEventHandler } from "./matrix-loop-event-handler"

export interface MatrixLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number; completionPromise?: string; ultrawork?: boolean }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => MatrixLoopState | null
}

const DEFAULT_API_TIMEOUT = 5000 as const

export function createMatrixLoopHook(
  ctx: PluginInput,
  options?: MatrixLoopOptions
): MatrixLoopHook {
  const config = options?.config
  const stateDir = config?.state_dir
  const getTranscriptPath = options?.getTranscriptPath ?? getDefaultTranscriptPath
  const apiTimeout = options?.apiTimeout ?? DEFAULT_API_TIMEOUT
  const checkSessionExists = options?.checkSessionExists

	const loopState = createLoopStateController({
		directory: ctx.directory,
		stateDir,
		config,
	})
	const sessionRecovery = createLoopSessionRecovery()

	const event = createMatrixLoopEventHandler(ctx, {
		directory: ctx.directory,
		apiTimeoutMs: apiTimeout,
		getTranscriptPath,
		checkSessionExists,
		sessionRecovery,
		loopState,
		verification: options?.verification,
	})

	return {
		event,
		startLoop: loopState.startLoop,
		cancelLoop: loopState.cancelLoop,
		getState: loopState.getState as () => MatrixLoopState | null,
	}
}
