import type { PluginInput } from "@opencode-ai/plugin"
import type { RalphLoopOptions, RalphLoopState } from "./types"
import { getTranscriptPath as getDefaultTranscriptPath } from "../claude-code-hooks/transcript"
import { createLoopSessionRecovery } from "./loop-session-recovery"
import { createLoopStateController } from "./loop-state-controller"
import { createRalphLoopEventHandler } from "./ralph-loop-event-handler"

export interface RalphLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number; completionPromise?: string; ultrawork?: boolean }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => RalphLoopState | null
}

const DEFAULT_API_TIMEOUT = 5000 as const

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions
): RalphLoopHook {
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

	const event = createRalphLoopEventHandler(ctx, {
		directory: ctx.directory,
		apiTimeoutMs: apiTimeout,
		getTranscriptPath,
		checkSessionExists,
		sessionRecovery,
		loopState,
	})

	return {
		event,
		startLoop: loopState.startLoop,
		cancelLoop: loopState.cancelLoop,
		getState: loopState.getState as () => RalphLoopState | null,
	}
}
