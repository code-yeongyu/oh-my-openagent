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
    options?: {
      maxIterations?: number
      completionPromise?: string
      messageCountAtStart?: number
      ultrawork?: boolean
      strategy?: "reset" | "continue"
    }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => RalphLoopState | null
  setOnLoopCompleted: (callback: (sessionID: string) => Promise<void> | void) => void
  setShouldDeferIteration: (callback: (sessionID: string) => Promise<boolean> | boolean) => void
}

const DEFAULT_API_TIMEOUT = 5000 as const

function getMessageCountFromResponse(messagesResponse: unknown): number {
  if (Array.isArray(messagesResponse)) {
    return messagesResponse.length
  }

  if (typeof messagesResponse === "object" && messagesResponse !== null && "data" in messagesResponse) {
    const data = (messagesResponse as { data?: unknown }).data
    return Array.isArray(data) ? data.length : 0
  }

  return 0
}

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions
): RalphLoopHook {
  const config = options?.config
  const stateDir = config?.state_dir
  const getTranscriptPath = options?.getTranscriptPath ?? getDefaultTranscriptPath
  const apiTimeout = options?.apiTimeout ?? DEFAULT_API_TIMEOUT
  const checkSessionExists = options?.checkSessionExists
  let onLoopCompleted = options?.onLoopCompleted
  let shouldDeferIteration = options?.shouldDeferIteration

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
		onLoopCompleted: async (sessionID: string) => {
			await onLoopCompleted?.(sessionID)
		},
		shouldDeferIteration: async (sessionID: string) => {
			return (await shouldDeferIteration?.(sessionID)) ?? false
		},
		sessionRecovery,
		loopState,
	})

	return {
		event,
		startLoop: (sessionID, prompt, loopOptions): boolean => {
			const startSuccess = loopState.startLoop(sessionID, prompt, loopOptions)
			if (!startSuccess || typeof loopOptions?.messageCountAtStart === "number") {
				return startSuccess
			}

			ctx.client.session
				.messages({
					path: { id: sessionID },
					query: { directory: ctx.directory },
				})
				.then((messagesResponse: unknown) => {
					const messageCountAtStart = getMessageCountFromResponse(messagesResponse)
					loopState.setMessageCountAtStart(sessionID, messageCountAtStart)
				})
				.catch(() => {})

			return startSuccess
		},
		cancelLoop: loopState.cancelLoop,
		getState: loopState.getState as () => RalphLoopState | null,
		setOnLoopCompleted: (callback) => {
			onLoopCompleted = callback
		},
		setShouldDeferIteration: (callback) => {
			shouldDeferIteration = callback
		},
	}
}
